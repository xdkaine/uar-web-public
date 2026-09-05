# Disposable browser proof stack

This stack is isolated under the Compose project `uar-browser-test`. It uses an ephemeral PostgreSQL database and Redis, a synthetic Samba AD domain over verified LDAPS with its own short-lived test CA, Mailpit SMTP capture, and Cloudflare's documented always-pass test credentials. It does not add an application authentication bypass and has no route to production directory, SMTP, database, Redis, or VPN systems.

From `my-app/`:

```sh
npm run test:e2e:install
npm run test:e2e:stack
npm run test:e2e
npm run test:e2e:stack:down
```

The fixture users share `Fixture-only-42!` unless `BROWSER_TEST_USER_PASSWORD` is supplied. They exist only inside the disposable domain. The personas are user owner, directory-group assignee, director, faculty, message administrator, directory administrator, ticket administrator, audit exporter, user manager, and full administrator; anonymous journeys require no fixture identity.

Visual baselines are intentionally updated only by `npm run test:e2e:update` after human review. Normal runs compare against the checked-in baselines. Mail is captured at `http://127.0.0.1:4425` and never delivered externally.

`test:e2e:stack:down` deletes only volumes owned by the explicit `uar-browser-test` Compose project. Do not reuse that project name for durable data.
