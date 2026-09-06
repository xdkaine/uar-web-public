import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import poller


SOURCE = "a" * 40
DIGEST = "b" * 64


def app():
    return {"id": "test-dev", "repository": "example/application", "branch": "dev",
            "checkout": "/var/lib/uar-delivery/repositories/application",
            "targets": {"api": {"namespace": "test-dev", "deployment": "api", "container": "api",
                                   "imageRepository": "ghcr.io/example/application-api"}},
            "approvedSchemaHashes": {"database": "sha256:" + "c" * 64},
            "probes": [{"url": "https://test.example.org/health"}]}


def receipt():
    return {"schema": 1, "repository": "example/application", "branch": "dev", "source": SOURCE,
            "images": {"api": "ghcr.io/example/application-api@sha256:" + DIGEST},
            "schemaHashes": {"database": "sha256:" + "c" * 64}}


class ReceiptTests(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(poller.validate_receipt(receipt(), app(), SOURCE), receipt())

    def test_hostile_and_stale_receipts(self):
        variants = [
            {"schema": 2}, {"repository": "other/application"}, {"branch": "main"},
            {"source": "d" * 40}, {"source": "$(id)"},
            {"images": {"api": "ghcr.io/example/application-api:latest"}},
            {"images": {"api": "ghcr.io/attacker/application-api@sha256:" + DIGEST}},
            {"images": {"api": "ghcr.io/example/application-api@sha256:" + DIGEST + ";id"}},
            {"images": {}}, {"images": {"api": receipt()["images"]["api"], "extra": "unused"}},
            {"schemaHashes": {}}, {"schemaHashes": {"database": "sha256:" + "e" * 64}},
        ]
        for modification in variants:
            with self.subTest(modification=modification):
                item = receipt() | modification
                with self.assertRaises(poller.DeliveryError):
                    poller.validate_receipt(item, app(), SOURCE)

    def test_schema_hash_cannot_be_omitted_even_for_no_schema(self):
        target = app()
        target["approvedSchemaHashes"] = {}
        item = receipt()
        del item["schemaHashes"]
        with self.assertRaises(poller.DeliveryError):
            poller.validate_receipt(item, target, SOURCE)

    def test_configuration_targets_are_fixed(self):
        for field, value in [("namespace", "default;id"), ("deployment", "--all"),
                             ("container", "../../bad"), ("imageRepository", "docker.io/other/app")]:
            target = app()
            target["targets"]["api"][field] = value
            with self.subTest(field=field), self.assertRaises(poller.DeliveryError):
                poller.validate_config({"applications": [target], "stateDirectory": "/var/lib/uar-delivery/state"})

    def test_valid_config(self):
        poller.validate_config({"applications": [app()], "stateDirectory": "/var/lib/uar-delivery/state"})

    def test_migration_artifact_validated_but_not_deployed(self):
        target = app()
        target["artifactRepositories"] = {"migrate": "ghcr.io/example/application-migrate"}
        item = receipt()
        item["images"]["migrate"] = "ghcr.io/example/application-migrate@sha256:" + DIGEST
        poller.validate_receipt(item, target, SOURCE)
        item["images"]["migrate"] = "ghcr.io/attacker/migrate@sha256:" + DIGEST
        with self.assertRaises(poller.DeliveryError):
            poller.validate_receipt(item, target, SOURCE)

    @patch("poller.git", side_effect=["", "d" * 40])
    def test_source_recheck_rejects_advanced_branch(self, git):
        with self.assertRaises(poller.DeliveryError):
            poller.recheck_source(app(), SOURCE)


class ApplyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.state = Path(self.temporary.name)
        self.recheck = patch("poller.recheck_source")
        self.recheck_mock = self.recheck.start()

    def tearDown(self):
        self.recheck.stop()
        self.temporary.cleanup()

    @patch("poller.kubectl")
    def test_dry_run_never_touches_cluster(self, command):
        self.assertEqual(poller.apply_receipt(app(), receipt(), "f" * 40, self.state, dry_run=True), "validated-dry-run")
        command.assert_not_called()
        self.assertEqual(list(self.state.iterdir()), [])

    def command(self, target, *args):
        if args[0] == "get":
            return json.dumps({"spec": {"template": {"spec": {"containers": [
                {"name": "api", "image": "prior-image"}, {"name": "sidecar", "image": "preserve-me"}]}}}})
        return ""

    @patch("poller.probe_revision")
    def test_success_preserves_prior_image_and_only_patches_configured_container(self, probe):
        with patch("poller.kubectl", side_effect=self.command) as command:
            result = poller.apply_receipt(app(), receipt(), "f" * 40, self.state)
        self.assertEqual(result, "success")
        saved = json.loads((self.state / "test-dev.json").read_text())
        self.assertEqual(saved["previousImages"], {"api": "prior-image"})
        self.assertEqual(saved["status"], "success")
        patch_call = next(call for call in command.call_args_list if call.args[1] == "patch")
        payload = json.loads(patch_call.args[-1])
        self.assertEqual(payload["spec"]["template"]["spec"]["containers"],
                         [{"name": "api", "image": receipt()["images"]["api"]}])
        probe.assert_called_once_with(app()["probes"][0], SOURCE)

    @patch("poller.time.sleep")
    @patch("poller.probe_revision", side_effect=poller.DeliveryError("wrong revision"))
    def test_failed_probe_never_records_success(self, probe, sleep):
        with patch("poller.kubectl", side_effect=self.command), self.assertRaises(poller.DeliveryError):
            poller.apply_receipt(app(), receipt(), "f" * 40, self.state)
        saved = json.loads((self.state / "test-dev.json").read_text())
        self.assertEqual(saved["status"], "failed")
        self.assertEqual(saved["previousImages"], {"api": "prior-image"})

    @patch("poller.kubectl")
    def test_verified_success_is_idempotent(self, command):
        (self.state / "test-dev.json").write_text(json.dumps({"status": "success", "receiptCommit": "f" * 40}))
        self.assertEqual(poller.apply_receipt(app(), receipt(), "f" * 40, self.state), "unchanged")
        command.assert_not_called()

    def test_source_advance_after_snapshot_prevents_all_patches(self):
        self.recheck_mock.side_effect = poller.DeliveryError("stale")
        with patch("poller.kubectl", side_effect=self.command) as command, self.assertRaises(poller.DeliveryError):
            poller.apply_receipt(app(), receipt(), "f" * 40, self.state)
        self.assertTrue(all(call.args[1] == "get" for call in command.call_args_list))
        self.assertEqual(json.loads((self.state / "test-dev.json").read_text())["status"], "failed")


if __name__ == "__main__":
    unittest.main()
