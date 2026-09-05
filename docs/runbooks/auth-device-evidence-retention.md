# Auth device-evidence retention

The `auth-device-evidence-maintenance` service deletes expired observations in
bounded batches. It runs independently of sign-in traffic and
`AUTH_DEVICE_RISK_MODE`.

## Check status

Use `docker compose --profile auth ps auth-device-evidence-maintenance`. An
unhealthy container has not completed its first pass, or its last successful
pass is older than the configured interval plus health grace. Inspect
`docker compose --profile auth logs auth-device-evidence-maintenance` and the
`DEVICE_EVIDENCE_PURGE_STARTED` / `DEVICE_EVIDENCE_PURGED` audit events. A
`partial` outcome means expired rows remain after the bounded pass.

## Catch up

After applying all auth-service migrations, run one bounded pass with the same
image and database configuration:

```text
docker compose --profile auth run --rm auth-device-evidence-maintenance node dist/prune-device-observations.js
```

Repeat while the completion audit reports `backlogRemaining: true`. For a
large backlog, increase `AUTH_DEVICE_PURGE_MAX_BATCHES` gradually (maximum
1000) or `AUTH_DEVICE_PURGE_BATCH_SIZE` (maximum 5000), monitor database load,
and restore the normal values afterward. The loop automatically retries failed
or partial passes after `AUTH_DEVICE_PURGE_RETRY_SECONDS` rather than waiting a
full day.

## Recovery and rollback

Schema/permission errors require fixing the migration or database grant first;
restarting alone does not make the health check pass. Roll application code
back before schema changes, set `AUTH_DEVICE_RISK_MODE=off`, and leave the
additive evidence table intact so the worker can continue retention without
destroying incident evidence.
