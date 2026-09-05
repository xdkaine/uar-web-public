# Database role separation tool

Run `apply.sh` only through the operator procedure in
`docs/runbooks/database-role-separation.md`. It expects a database-owner libpq
connection in `PG*` variables and three new role passwords in environment
variables. It changes database ownership and grants; it is not a build or
application-startup hook.

`provision.sql` is idempotent and `verify.sql` is read-only. `verify.sh` runs
the read-only checks by themselves with the same owner `PG*` connection.
`provision.sql` contains an explicit table ownership map and aborts when an
existing public table is unclassified. Re-run provisioning and verification
after every portal-first/auth-second migration so new tables remain
inaccessible to runtimes until explicitly classified.
