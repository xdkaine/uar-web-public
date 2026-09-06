import json
from pathlib import Path
import tempfile
import unittest
from publish_release import KINDS, check_origins, load_digests
from render_release import render_release, UPSTREAM_IMAGES

SHA = 'a' * 40
DIGEST = 'sha256:' + 'b' * 64


class ReleaseContractTests(unittest.TestCase):
    def receipts(self, root):
        for kind in KINDS:
            Path(root, kind + '.json').write_text(json.dumps({'kind': kind, 'digest': DIGEST, 'source': SHA}))

    def test_requires_same_source_and_complete_image_set(self):
        with tempfile.TemporaryDirectory() as root:
            self.receipts(root)
            images = load_digests(root, SHA)
            self.assertEqual(len(images), 3)
            Path(root, 'portal.json').unlink()
            with self.assertRaises(ValueError):
                load_digests(root, SHA)
            self.receipts(root)
            Path(root, 'portal.json').write_text(json.dumps({'kind': 'portal', 'digest': DIGEST, 'source': 'c' * 40}))
            with self.assertRaises(ValueError):
                load_digests(root, SHA)

    def test_rejects_mutable_tags_unknown_and_duplicate_receipts(self):
        with tempfile.TemporaryDirectory() as root:
            self.receipts(root)
            Path(root, 'portal.json').write_text(json.dumps({'kind': 'portal', 'digest': 'latest', 'source': SHA}))
            with self.assertRaises(ValueError):
                load_digests(root, SHA)
            self.receipts(root)
            Path(root, 'duplicate.json').write_text(Path(root, 'portal.json').read_text())
            with self.assertRaises(ValueError):
                load_digests(root, SHA)

    def test_rejects_unsafe_build_origins(self):
        for bad in ('http://dev.example.org', 'https://user:pass@dev.example.org',
                    'https://dev.example.org/path', 'https://portal.example.test', 'https://dev.example.org?q=1'):
            with self.assertRaises(ValueError):
                check_origins(bad, 'https://auth.example.org')
        check_origins('https://portal.example.org', 'https://auth.example.org')
        with self.assertRaises(ValueError):
            check_origins('https://portal.example.org', 'https://portal.example.org/')

    def test_render_uses_immutable_release_paths_and_images(self):
        root = Path(__file__).resolve().parents[1] / 'k8s'
        images = {kind: 'ghcr.io/xdkaine/uar-web-public-' + kind + '@' + DIGEST for kind in KINDS}
        upstreams = {image: image.split(':')[0] + '@' + DIGEST for image in UPSTREAM_IMAGES}
        rendered = render_release(root, SHA, images, upstreams)
        self.assertTrue(rendered)
        for path, body in rendered.items():
            self.assertTrue(path.startswith(('release/' + SHA + '/', 'deploy/k8s/flux/')))
            self.assertNotIn('UNRELEASED', body)
            self.assertNotIn('RELEASE_ID', body)
        release = rendered['deploy/k8s/flux/release.yaml']
        self.assertIn('./release/' + SHA + '/migrations', release)
        self.assertIn('observedGeneration', release)
        self.assertIn("dep.metadata.labels['uar.dev/release']", release)


    def test_portal_release_does_not_own_standalone_auth(self):
        root = Path(__file__).resolve().parents[1] / 'k8s'
        images = {kind: 'ghcr.io/xdkaine/uar-web-public-' + kind + '@' + DIGEST for kind in KINDS}
        upstreams = {image: image.split(':')[0] + '@' + DIGEST for image in UPSTREAM_IMAGES}
        rendered = render_release(root, SHA, images, upstreams)
        service = rendered[f'release/{SHA}/apps/auth.yaml']
        self.assertIn('kind: Service', service)
        self.assertIn('type: ExternalName', service)
        self.assertIn('externalName: auth.auth-dev.svc.cluster.local', service)
        self.assertNotIn('selector:', service)
        self.assertNotIn('kind: Deployment', service)
        job = rendered[f'release/{SHA}/migrations/job.yaml']
        self.assertNotIn('auth-migration', job)
        self.assertIn('AUTH_DATABASE_PASSWORD', job)
        runner = rendered[f'release/{SHA}/migrations/run-release.cjs']
        self.assertNotIn('/app/auth-migration/', runner)
        self.assertIn('apply and verify runtime grants', runner)


if __name__ == '__main__':
    unittest.main()
