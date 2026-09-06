\set ON_ERROR_STOP on
\getenv migration_password MIGRATION_DATABASE_PASSWORD
\getenv portal_password PORTAL_DATABASE_PASSWORD
\getenv auth_password AUTH_DATABASE_PASSWORD
BEGIN;
-- Install the checked-in migration prerequisite with the administrator connection.
-- The migration login remains unable to create arbitrary database extensions.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SELECT 'CREATE ROLE uar_schema_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uar_schema_owner')
\gexec
SELECT 'CREATE ROLE uar_migration NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uar_migration')
\gexec
SELECT 'CREATE ROLE uar_portal_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uar_portal_runtime')
\gexec
SELECT 'CREATE ROLE uar_auth_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uar_auth_runtime')
\gexec
ALTER ROLE uar_schema_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE uar_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD :'migration_password';
ALTER ROLE uar_portal_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'portal_password';
ALTER ROLE uar_auth_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'auth_password';
GRANT uar_schema_owner TO uar_migration;
REVOKE uar_schema_owner, uar_migration FROM uar_portal_runtime, uar_auth_runtime;
ALTER SCHEMA public OWNER TO uar_schema_owner;
GRANT USAGE, CREATE ON SCHEMA public TO uar_migration;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, uar_portal_runtime, uar_auth_runtime;
SELECT format('GRANT CONNECT ON DATABASE %I TO uar_migration, uar_portal_runtime, uar_auth_runtime', current_database())
\gexec
COMMIT;
