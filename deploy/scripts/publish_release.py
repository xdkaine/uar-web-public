"""Publish only complete, tested dev image sets to the public deployment ref."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request

KINDS = frozenset({'portal', 'auth', 'portal-migrate', 'auth-migrate', 'monitor'})
REPOSITORY = 'xdkaine/uar-web-public'
SHA_PATTERN = re.compile(r'^[0-9a-f]{40}$')
DIGEST_PATTERN = re.compile(r'^sha256:[0-9a-f]{64}$')


def check_origins(portal, auth):
    for value in (portal, auth):
        parsed = urllib.parse.urlsplit(value)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username
                or parsed.password or parsed.query or parsed.fragment
                or parsed.path not in ('', '/') or parsed.hostname.endswith(('.test', '.invalid'))):
            raise ValueError('Development origins must be configured HTTPS origins, without credentials or paths.')
    if portal.rstrip('/') == auth.rstrip('/'):
        raise ValueError('Portal and auth must have distinct origins.')


def load_digests(directory, source):
    if not SHA_PATTERN.fullmatch(source):
        raise ValueError('Expected a full source commit SHA.')
    result = {}
    for path in Path(directory).glob('*.json'):
        item = json.loads(path.read_text())
        kind = item.get('kind')
        if kind not in KINDS or kind in result or item.get('source') != source:
            raise ValueError('Unknown, duplicate, or mixed-source image receipt.')
        digest = item.get('digest', '')
        if not DIGEST_PATTERN.fullmatch(digest):
            raise ValueError('Expected an immutable SHA-256 image digest.')
        result[kind] = f'ghcr.io/{REPOSITORY}-{kind}@{digest}'
    if set(result) != KINDS:
        raise ValueError('All five tested image receipts are required.')
    return result


def api(path, data=None, method=None, missing_ok=False):
    req = urllib.request.Request('https://api.github.com/repos/' + REPOSITORY + '/' + path,
        data=None if data is None else json.dumps(data).encode(), method=method,
        headers={'Accept': 'application/vnd.github+json',
                 'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404 and missing_ok:
            return None
        # Do not print request headers or bodies on authentication failures.
        raise RuntimeError(f'GitHub API failed with HTTP {error.code} for {path}') from None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check-origins', action='store_true')
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    check_origins(os.environ['DEV_PORTAL_URL'], os.environ['DEV_AUTH_URL'])
    if args.check_origins:
        print('Public development origins validated.')
        return
    if not args.publish or os.environ.get('GITHUB_REF') != 'refs/heads/dev':
        raise ValueError('Publishing requires the dev branch workflow.')
    if os.environ.get('GITHUB_REPOSITORY') != REPOSITORY:
        raise ValueError('Unexpected repository; configure a separate deployment for forks.')
    source = os.environ['GITHUB_SHA']
    images = load_digests('digests', source)
    if api('git/ref/heads/dev')['object']['sha'] != source:
        print('A newer dev commit exists; stale release skipped.')
        return
    from render_release import render_release
    files = render_release(Path('deploy/k8s'), source, images)
    files[f'release/{source}/release.json'] = json.dumps({
        'source': source, 'workflow_run': os.environ['GITHUB_RUN_ID'], 'images': images,
        'portal_origin': os.environ['DEV_PORTAL_URL'], 'auth_origin': os.environ['DEV_AUTH_URL']
    }, indent=2) + '\n'
    previous = api('git/ref/heads/deploy/dev', missing_ok=True)
    parent = previous['object']['sha'] if previous else source
    parent_commit = api('git/commits/' + parent)
    tree = []
    for path, content in sorted(files.items()):
        blob = api('git/blobs', {'content': base64.b64encode(content.encode()).decode(), 'encoding': 'base64'})
        tree.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
    request = {'tree': tree}
    if previous:
        request['base_tree'] = parent_commit['tree']['sha']
    tree_sha = api('git/trees', request)['sha']
    commit = api('git/commits', {'message': f'deploy(dev): release {source[:12]}',
        'tree': tree_sha, 'parents': [parent]})['sha']
    if api('git/ref/heads/dev')['object']['sha'] != source:
        print('A newer dev commit arrived; deployment ref left unchanged.')
        return
    if previous:
        api('git/refs/heads/deploy/dev', {'sha': commit, 'force': False}, method='PATCH')
    else:
        api('git/refs', {'ref': 'refs/heads/deploy/dev', 'sha': commit})
    print(f'Published development release {source[:12]} to deploy/dev.')


if __name__ == '__main__':
    main()
