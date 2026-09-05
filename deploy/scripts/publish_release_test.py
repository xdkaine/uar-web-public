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
            self.assertEqual(len(images), 5)
            Path(root, 'auth.json').unlink()
            with self.assertRaises(ValueError):
                load_digests(root, SHA)
            self.receipts(root)
            Path(root, 'auth.json').write_text(json.dumps({'kind': 'auth', 'digest': DIGEST, 'source': 'c' * 40}))
            with self.assertRaises(ValueError):
                load_digests(root, SHA)

    def test_rejects_mutable_tags_unknown_and_duplicate_receipts(self):
        with tempfile.TemporaryDirectory() as root:
            self.receipts(root)
            Path(root, 'auth.json').write_text(json.dumps({'kind': 'auth', 'digest': 'latest', 'source': SHA}))
            with self.assertRaises(ValueError):
                load_digests(root, SHA)
            self.receipts(root)
            Path(root, 'duplicate.json').write_text(Path(root, 'auth.json').read_text())
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


if __name__ == '__main__':
    unittest.main()
