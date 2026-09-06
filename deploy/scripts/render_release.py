"""Render immutable release directories; never embed deployment credentials."""
from pathlib import Path
import re
import subprocess

IMAGE_TOKENS = {
    'uar-portal:UNRELEASED': 'portal',
    'uar-portal-migrate:UNRELEASED': 'portal-migrate',
    'uar-monitor:UNRELEASED': 'monitor',
}
UPSTREAM_IMAGES = ('postgres:16-alpine', 'redis:7-alpine', 'nginx:1.27-alpine', 'clamav/clamav:stable', 'curlimages/curl:8.12.1')
DIGEST = re.compile(r'^sha256:[0-9a-f]{64}$')


def resolve_upstreams():
    result = {}
    for image in UPSTREAM_IMAGES:
        digest = subprocess.check_output(
            ['docker', 'buildx', 'imagetools', 'inspect', image, '--format', '{{.Manifest.Digest}}'],
            text=True, timeout=120).strip()
        if not DIGEST.fullmatch(digest):
            raise ValueError('Could not resolve an upstream image to an immutable digest.')
        result[image] = image.split(':')[0] + '@' + digest
    return result


def render_release(root, source, images, upstreams=None):
    if not re.fullmatch(r'[0-9a-f]{40}', source):
        raise ValueError('Invalid release identifier.')
    if upstreams is None:
        upstreams = resolve_upstreams()
    replacements = {token: images[kind] for token, kind in IMAGE_TOKENS.items()}
    replacements.update(upstreams)
    replacements['RELEASE_ID'] = source
    replacements['uar-migrate-release-id'] = 'uar-migrate-' + source
    result = {}
    for group in ('infra', 'migrations', 'apps', 'flux'):
        folder = Path(root) / group
        if not folder.is_dir():
            raise ValueError('Missing deployment template group: ' + group)
        for path in sorted(folder.rglob('*')):
            if not path.is_file() or '.test.' in path.name:
                continue
            if path.is_symlink() or path.suffix not in ('.yaml', '.yml', '.conf', '.sql', '.mjs', '.cjs', '.json'):
                raise ValueError('Unexpected deployment template type: ' + str(path))
            content = path.read_text()
            for before, after in replacements.items():
                content = content.replace(before, after)
            if 'UNRELEASED' in content or 'RELEASE_ID' in content:
                raise ValueError('Unresolved release placeholder in ' + str(path))
            prefix = 'deploy/k8s/flux' if group == 'flux' else f'release/{source}/{group}'
            result[prefix + '/' + path.relative_to(folder).as_posix()] = content
    return result
