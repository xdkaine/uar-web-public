# Batch account spreadsheets

Open **Batch operations → New batch → Accounts**. Download the XLSX template, fill in sheet 1 (**AD accounts**) and sheet 2 (**VPN accounts**), then import the workbook. The template's Instructions sheet defines every column and required value. Keep its sheet names and headers. Passwords and usernames are text cells; formulas are not accepted. Blank rows are ignored.

Import adds editable accounts to the current draft. It does not create accounts. Review the rows, resolve validation errors, and complete the existing confirmation step. The combined manual/imported draft is limited to 100 accounts and requires at least one AD account. Submission replay protection, per-account ownership checks, and processing locks still apply. Imported files and plaintext draft passwords are not persisted in browser storage. Manual passwords can be generated and shown or hidden beside the input.

After processing, open the batch run and use **Download Excel with passwords**. This action is available to the creating operator with `batch.manage`. The result includes separate AD and VPN sheets, account details, batch run and item IDs, outcomes, initial passwords where available, and an explicit reason for every unavailable password. This results file is not an import template.

The download contains sensitive plaintext credentials. Store and share it securely. These are initial passwords; they may have changed since creation. New AD accounts are created disabled and must be enabled separately through Account Lifecycle.

## Credential disclosure boundary

- `POST /api/admin/batch-accounts/[id]/export` requires authenticated, rate-limited admin access, `batch.manage`, matching batch creator, and CSRF validation.
- Completed and failed runs can be exported. Only successfully completed standalone batch-owned items from a completed run can disclose initial passwords, with recorded completion and system-specific identity evidence.
- Password disclosure respects `password.cleanup.retentionDays`, capped at seven days from item completion, even if scheduled cleanup has not run. Cleared credentials are not recovered from another record.
- Legacy request-owned accounts retain their existing request credential workflow. Processing, failed, rolled-back, unresolved, deleted AD and revoked/deleted VPN credentials are not disclosed.
- The dedicated `export_batch_initial_passwords` audit must persist before any file is returned. It records item IDs and availability reasons, never passwords or workbook contents. The response is an attachment with no-store headers; normal batch APIs still exclude passwords.

No migration is required. Rollback removes the import/export UI and endpoint without changing existing encrypted credentials or cleanup policy.

## Ownership review findings

New accounts use one creation batch run and one item per account as their tracking records; they do not need synthetic access requests. The detail view shows this ownership directly. Missing or conflicting batch tracking, unresolved ownership, missing historical request linkage, and missing AD DN/object GUID evidence still require review.

## Implementation validation — 2026-09-06

The following commands ran from `my-app/` using the bundled Windows Node v24.19.0 executable (`/mnt/c/Users/xtomm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`) in place of `node`:

| Command | Result |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run` | 282 files, 2,128 tests passed |
| `node node_modules/typescript/bin/tsc --noEmit --pretty false --incremental false` | Passed |
| `node node_modules/eslint/bin/eslint.js` | Zero errors; 28 warnings in unchanged files |
| `node e2e/components/check-batch-password.mjs` | Passed at 390/1280 widths: password show/hide/generate, template download, actual five-AD/three-VPN XLSX parsing, exact password/username preservation, invalid-file handling |
| `node e2e/components/check-batch-export.mjs` | Passed at 390/1280 widths: visible failure, retry, CSRF POST, and attachment download using local API mocks |
| `git diff --check` (repository root) | Passed |

The static template was loaded and checked for sheet names, headers, blank rows, text formats, and dropdown validation. Identity and lifecycle domain reviews were completed. Docker's CLI reported unavailable WSL integration, so the required Docker builder/container checks could not run. No live AD, VPN, database, Redis, SMTP, or production provisioning was exercised, and no deployment was performed.

Existing credential cleanup of failed/reconciled items and older server input-validation gaps remain separate work; this change does not alter retention-at-rest or recovery processing. The two-megabyte XLSX file limit bounds ordinary input size but does not fully bound decompression memory in the importing browser.
