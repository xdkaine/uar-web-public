"""Retire exactly the two superseded Portal-owned Auth packages."""
import base64
import json
import os
import re
import urllib.error
import urllib.request

REPOSITORY = 'xdkaine/uar-web-public'
PACKAGES = ('uar-web-public-auth', 'uar-web-public-auth-migrate')


def api(path, method='GET', missing=False):
    request = urllib.request.Request('https://api.github.com' + path, method=method,
        headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return None if response.status == 204 else json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404 and missing:
            return None
        raise RuntimeError(f'Package retirement API failed with HTTP {error.code}') from None


def content(path):
    result = api('/repos/' + REPOSITORY + '/contents/' + path + '?ref=deploy%2Fdev')
    return base64.b64decode(result['content']).decode()


def validate_package(name, metadata, images):
    if name not in PACKAGES or metadata.get('name') != name or metadata.get('package_type') != 'container':
        raise ValueError('Package is outside the retirement allowlist')
    if metadata.get('repository', {}).get('full_name') != REPOSITORY:
        raise ValueError('Package repository association differs')
    prefix = 'ghcr.io/xdkaine/' + name
    if any(image.startswith(prefix + '@') or image.startswith(prefix + ':') for image in images):
        raise ValueError('An active release still references this package')


def main():
    if os.environ.get('GITHUB_REPOSITORY') != REPOSITORY or os.environ.get('GITHUB_REF') != 'refs/heads/dev':
        raise ValueError('Retirement must run from the approved development branch')
    flux = content('deploy/k8s/flux/release.yaml')
    sources = re.findall(r'path:\s+\./release/([0-9a-f]{40})/(?:apps|infra|migrations)\b', flux)
    if len(sources) != 3 or len(set(sources)) != 1:
        raise ValueError('Expected one complete current Flux release')
    receipt = json.loads(content('release/' + sources[0] + '/release.json'))
    images = list(receipt['images'].values())
    plan = []
    for name in PACKAGES:
        path = '/users/xdkaine/packages/container/' + name
        metadata = api(path, missing=True)
        if metadata is None:
            print(name + ': already absent')
            continue
        validate_package(name, metadata, images)
        plan.append((name, path))
    for name, path in plan:
        api(path, method='DELETE')
        if api(path, missing=True) is not None:
            raise RuntimeError('Package remains visible after deletion')
        print(name + ': retired and absence verified')


if __name__ == '__main__':
    main()
