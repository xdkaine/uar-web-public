import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from plan_images import input_hash, prior_release, reusable, validate_receipts
from publish_release import KINDS, REPOSITORY

SHA = 'a' * 40
OLD = 'b' * 40
HASH = 'c' * 64
DIGEST = 'sha256:' + 'd' * 64


class ReuseTests(unittest.TestCase):
    def baseline(self):
        return OLD, {'source': OLD,
                     'images': {k: f'ghcr.io/{REPOSITORY}-{k}@{DIGEST}' for k in KINDS},
                     'inputHashes': {k: HASH for k in KINDS}, 'builtFrom': {k: OLD for k in KINDS}}

    def test_unchanged_auxiliary_reuses_original_provenance(self):
        for kind in ('monitor', 'portal-migrate'):
            item = reusable(kind, HASH, self.baseline(), lambda _: DIGEST)
            self.assertEqual(item['builtFrom'], OLD)
            self.assertEqual(item['digest'], DIGEST)

    def test_runtime_always_builds_and_changes_or_missing_baseline_build(self):
        self.assertIsNone(reusable('portal', HASH, self.baseline(), lambda _: DIGEST))
        self.assertIsNone(reusable('monitor', 'f' * 64, self.baseline(), lambda _: DIGEST))
        self.assertIsNone(reusable('monitor', HASH, None))
        old = self.baseline()
        old[1].pop('builtFrom')
        self.assertIsNone(reusable('monitor', HASH, old))

    def test_deleted_or_inaccessible_registry_digest_builds(self):
        def failure(_):
            raise subprocess.CalledProcessError(1, 'docker')
        self.assertIsNone(reusable('monitor', HASH, self.baseline(), failure))
        self.assertIsNone(reusable('monitor', HASH, self.baseline(), lambda _: 'sha256:' + 'e' * 64))

    def test_provenance_and_stale_input_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            for kind in KINDS:
                item = dict(kind=kind, source=SHA, digest=DIGEST, inputHash=HASH, builtFrom=SHA)
                if kind != 'portal':
                    item.update(baselineRef=OLD, builtFrom=OLD)
                Path(folder, kind + '.json').write_text(json.dumps(item))
            _, hashes, built = validate_receipts(folder, SHA, lambda _: self.baseline(), lambda _: HASH)
            self.assertEqual(built['monitor'], OLD)
            self.assertEqual(built['portal'], SHA)
            with self.assertRaisesRegex(ValueError, 'inputs do not match'):
                validate_receipts(folder, SHA, lambda _: self.baseline(), lambda _: 'e' * 64)
            wrong = self.baseline()
            wrong[1]['builtFrom']['monitor'] = SHA
            with self.assertRaisesRegex(ValueError, 'immutable baseline'):
                validate_receipts(folder, SHA, lambda _: wrong, lambda _: HASH)

    def test_input_hash_tracks_deletion_modes_and_base_updates(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            subprocess.run(['git', 'init', '-q', folder], check=True)
            (root / 'services/monitor-probe').mkdir(parents=True)
            (root / 'services/monitor-probe/Dockerfile').write_text('FROM node:20-alpine\nCOPY services/monitor-probe/server.mjs ./\n')
            script = root / 'services/monitor-probe/server.mjs'
            script.write_text('original')
            subprocess.run(['git', '-C', folder, 'add', '.'], check=True)
            hash1 = input_hash('monitor', root, lambda _: DIGEST)
            script.write_text('changed')
            self.assertNotEqual(hash1, input_hash('monitor', root, lambda _: DIGEST))
            script.write_text('original')
            self.assertEqual(hash1, input_hash('monitor', root, lambda _: DIGEST))
            self.assertNotEqual(hash1, input_hash('monitor', root, lambda _: 'sha256:' + 'e' * 64))
            subprocess.run(['git', '-C', folder, 'update-index', '--chmod=+x', 'services/monitor-probe/server.mjs'], check=True)
            self.assertNotEqual(hash1, input_hash('monitor', root, lambda _: DIGEST))
            subprocess.run(['git', '-C', folder, 'rm', '-f', 'services/monitor-probe/server.mjs'], check=True, stdout=subprocess.DEVNULL)
            self.assertNotEqual(hash1, input_hash('monitor', root, lambda _: DIGEST))

    def test_active_release_requires_unique_exact_source(self):
        with patch('plan_images.read_file', return_value=f'path: ./release/{SHA}/apps\npath: ./release/{OLD}/infra'):
            self.assertIsNone(prior_release(OLD))
        with patch('plan_images.read_file', side_effect=[f'path: ./release/{SHA}/apps', json.dumps({'source': OLD})]):
            self.assertIsNone(prior_release(OLD))


if __name__ == '__main__':
    unittest.main()
