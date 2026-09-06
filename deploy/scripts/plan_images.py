"""Reuse auxiliary images only from an immutable, input-matched release receipt."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

from publish_release import api, DIGEST_PATTERN, KINDS, REPOSITORY, SHA_PATTERN

INPUTS = {
    'portal-migrate': ('Dockerfile', 'Dockerfile.dockerignore', '.dockerignore', '.github/workflows/dev.yml', 'my-app/.npmrc', 'my-app/package.json',
                       'my-app/package-lock.json*', 'my-app/prisma.config.ts', 'my-app/prisma',
                       'tools/database-role-separation', 'deploy/scripts/plan_images.py'),
    'monitor': ('services/monitor-probe', '.dockerignore', '.github/workflows/dev.yml', 'deploy/scripts/plan_images.py'),
    'portal': ('Dockerfile', 'Dockerfile.dockerignore', '.dockerignore', '.github/workflows/dev.yml', 'my-app', 'docker-compose.yml',
               'tools/database-role-separation', 'deploy/scripts/plan_images.py'),
}


def input_hash(kind, root=Path('.'), resolver=None):
    """Hash tracked names, modes, contents, public args and resolved mutable bases."""
    resolver = resolver or resolve_digest
    records = subprocess.check_output(['git', 'ls-files', '-s', '-z', '--', *INPUTS[kind]], cwd=root).split(b'\0')
    digest = hashlib.sha256()
    for record in sorted(filter(None, records)):
        metadata, name = record.split(b'\t', 1)
        mode = metadata.split()[0]
        path = root / os.fsdecode(name)
        if path.is_symlink():
            content = os.readlink(path).encode()
        else:
            content = path.read_bytes()
        digest.update(mode + b'\0' + name + b'\0' + str(len(content)).encode() + b'\0' + content)
    dockerfile = root / ('services/monitor-probe/Dockerfile' if kind == 'monitor' else 'Dockerfile')
    body = dockerfile.read_text()
    stages = set()
    for value, stage in re.findall(r'^FROM\s+(\S+)(?:\s+AS\s+(\S+))?', body, re.M | re.I):
        if value not in stages:
            digest.update((value + '@' + resolver(value)).encode())
        if stage:
            stages.add(stage)
    syntax = re.search(r'^# syntax=(\S+)', body, re.M)
    if syntax:
        digest.update(resolver(syntax.group(1)).encode())
    if kind == 'portal':
        for key in ('DEV_PORTAL_URL', 'DEV_TURNSTILE_SITE_KEY', 'GITHUB_SHA'):
            digest.update((key + '=' + os.environ.get(key, '')).encode())
    return digest.hexdigest()


def resolve_digest(image):
    result = subprocess.check_output(['docker', 'buildx', 'imagetools', 'inspect', image,
                                     '--format', '{{.Manifest.Digest}}'], text=True, timeout=120).strip()
    if not DIGEST_PATTERN.fullmatch(result):
        raise ValueError('Registry returned an invalid immutable digest.')
    return result


def read_file(path, ref):
    item = api('contents/' + path + '?ref=' + ref, missing_ok=True)
    return base64.b64decode(item['content']).decode() if item else None


def prior_release(ref=None):
    if ref is None:
        branch = api('git/ref/heads/deploy/dev', missing_ok=True)
        if not branch:
            return None
        ref = branch['object']['sha']
    if not SHA_PATTERN.fullmatch(ref):
        raise ValueError('Invalid deployment commit.')
    config = read_file('deploy/k8s/flux/release.yaml', ref)
    sources = set(re.findall(r'path:\s*\./release/([0-9a-f]{40})/(?:infra|migrations|apps)\b', config or ''))
    if len(sources) != 1:
        return None
    source = sources.pop()
    body = read_file(f'release/{source}/release.json', ref)
    receipt = json.loads(body) if body else None
    if not receipt or receipt.get('source') != source:
        return None
    return ref, receipt


def reusable(kind, hashed, previous, resolver=resolve_digest):
    if kind == 'portal' or not previous:
        return None
    ref, receipt = previous
    image = receipt.get('images', {}).get(kind, '')
    built = receipt.get('builtFrom', {}).get(kind, '')
    prefix = f'ghcr.io/{REPOSITORY}-{kind}@'
    if (receipt.get('inputHashes', {}).get(kind) != hashed
            or not SHA_PATTERN.fullmatch(built) or not image.startswith(prefix)
            or not DIGEST_PATTERN.fullmatch(image[len(prefix):])):
        return None
    try:
        if resolver(image) != image[len(prefix):]:
            return None
    except (subprocess.SubprocessError, ValueError, OSError):
        return None
    return {'digest': image[len(prefix):], 'builtFrom': built, 'baselineRef': ref}


def validate_receipts(directory, source, previous_loader=prior_release, hasher=input_hash):
    """Recheck provenance against pinned prior receipts; never relabel an old build."""
    from publish_release import load_digests
    images = load_digests(directory, source)
    hashes, built_from = {}, {}
    for path in Path(directory).glob('*.json'):
        item = json.loads(path.read_text())
        kind = item['kind']
        hashed, built = item.get('inputHash', ''), item.get('builtFrom', '')
        if not re.fullmatch('[0-9a-f]{64}', hashed) or not SHA_PATTERN.fullmatch(built):
            raise ValueError('Missing build input hash or provenance.')
        if hashed != hasher(kind):
            raise ValueError('Receipt build inputs do not match this checkout.')
        if item.get('baselineRef'):
            if kind == 'portal':
                raise ValueError('Portal runtime must be built for this commit.')
            previous = previous_loader(item['baselineRef'])
            if not previous:
                raise ValueError('Missing reuse baseline.')
            receipt = previous[1]
            if (receipt.get('images', {}).get(kind) != images[kind]
                    or receipt.get('inputHashes', {}).get(kind) != hashed
                    or receipt.get('builtFrom', {}).get(kind) != built):
                raise ValueError('Reused image does not match its immutable baseline.')
        elif built != source:
            raise ValueError('New image build must match the current source.')
        hashes[kind], built_from[kind] = hashed, built
    return images, hashes, built_from


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('kind', choices=sorted(KINDS))
    parser.add_argument('--record', action='store_true')
    args = parser.parse_args()
    path = Path('image-plan.json')
    if args.record:
        item = json.loads(path.read_text())
        if item['kind'] != args.kind or item['source'] != os.environ['GITHUB_SHA']:
            raise ValueError('Plan belongs to another build.')
        if item.pop('build'):
            item['digest'] = os.environ['IMAGE_DIGEST']
        if not DIGEST_PATTERN.fullmatch(item['digest']):
            raise ValueError('Missing build digest.')
        Path('digests').mkdir(exist_ok=True)
        Path('digests', args.kind + '.json').write_text(json.dumps(item))
        return
    hashed = input_hash(args.kind)
    reuse = reusable(args.kind, hashed, prior_release())
    item = {'kind': args.kind, 'source': os.environ['GITHUB_SHA'], 'inputHash': hashed,
            'build': not bool(reuse), 'builtFrom': os.environ['GITHUB_SHA']}
    item.update(reuse or {})
    path.write_text(json.dumps(item))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write('build=' + str(item['build']).lower() + '\n')
    print(f"{args.kind}: {'build' if item['build'] else 'reuse verified immutable image'}")


if __name__ == '__main__':
    main()
