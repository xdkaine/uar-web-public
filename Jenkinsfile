pipeline {
    agent any
    
    environment {
        // Application name and version
        APP_NAME = 'uar-web'
        APP_VERSION = "${env.BUILD_NUMBER}"
        
        // Docker image name
        IMAGE_NAME = "uar-web:ci-${env.JOB_NAME.replaceAll('[^A-Za-z0-9_.-]', '-')}-${env.BUILD_NUMBER}"
        BUILDER_IMAGE_NAME = "uar-web:builder-ci-${env.JOB_NAME.replaceAll('[^A-Za-z0-9_.-]', '-')}-${env.BUILD_NUMBER}"
        
        // Auth service image name (built from the repo root context)
        AUTH_IMAGE_NAME = "uar-auth:ci-${env.JOB_NAME.replaceAll('[^A-Za-z0-9_.-]', '-')}-${env.BUILD_NUMBER}"
    }
    
    stages {
        stage('Checkout') {
            steps {
                echo 'Checking out source code...'
                checkout scm
            }
        }

        stage('Auth Service Install') {
            steps {
                echo 'Installing auth service dependencies...'
                script {
                    sh """
                        cd services/auth-service && npm ci --no-audit --no-fund
                    """
                }
            }
        }

        stage('Auth Service Lint') {
            steps {
                echo 'Linting auth service source...'
                script {
                    sh """
                        cd services/auth-service && npm run lint
                    """
                }
            }
        }

        stage('Auth Service Test') {
            steps {
                echo 'Running auth service tests...'
                script {
                    sh """
                        cd services/auth-service && npm test
                    """
                }
            }
        }

        stage('Validate Compose Contract') {
            steps {
                echo 'Validating Compose interpolation without printing resolved configuration...'
                script {
                    sh 'docker compose --env-file .env.example config --quiet'
                }
            }
        }

        stage('Portal Builder Image') {
            steps {
                echo 'Building the portal builder image used for lint and tests...'
                script {
                    sh """
                        docker build --target builder -t ${BUILDER_IMAGE_NAME} .
                    """
                }
            }
        }

        stage('Portal Lint and Test') {
            steps {
                echo 'Linting and testing portal source in the production Node build environment...'
                script {
                    sh """
                        docker run --rm --network none ${BUILDER_IMAGE_NAME} npm run lint
                        docker run --rm --network none ${BUILDER_IMAGE_NAME} npm run test:run
                    """
                }
            }
        }

        stage('Build Auth Service Image') {
            steps {
                echo 'Building auth service Docker image...'
                script {
                    // Built from the repo root context (see services/auth-service/Dockerfile)
                    sh """
                        docker build -f services/auth-service/Dockerfile -t ${AUTH_IMAGE_NAME} .
                    """
                }
            }
        }

        stage('Build Docker Image') {
            steps {
                echo 'Building Docker image...'
                script {
                    // Build the Docker image
                    sh """
                        docker build -t ${IMAGE_NAME} .
                    """
                }
            }
        }

        stage('Disposable Migration, Restore, and Browser Proof') {
            steps {
                echo 'Running the empty composite install, backup restore, persona, accessibility, and visual gates...'
                script {
                    sh '''
                        set -eu
                        # Fixture ports are fixed; agents sharing one Docker host
                        # must also share this lock path. Do not reuse a live stack.
                        command -v flock >/dev/null
                        exec 9>/tmp/uar-browser-test-ci.lock
                        flock -x 9
                        test_compose='tests/browser/docker-compose.yml'
                        project_digest=$(printf '%s' "$JOB_NAME/$BUILD_NUMBER" | sha256sum | cut -c1-16)
                        test_project="uar-ci-$project_digest"
                        export BROWSER_TEST_COMPOSE_PROJECT="$test_project"
                        restore_dump="${WORKSPACE}/uar-browser-restore.dump"
                        cleanup_browser_gate() {
                            docker compose -p "$test_project" -f "$test_compose" down --volumes --remove-orphans >/dev/null 2>&1 || true
                            rm -f "$restore_dump"
                        }
                        trap cleanup_browser_gate EXIT

                        docker compose -p "$test_project" -f "$test_compose" up --build -d --wait

                        db_container=$(docker compose -p "$test_project" -f "$test_compose" ps -q postgres)
                        test -n "$db_container"

                        # Historical 34334d6 shape -> full portal-first/auth-second upgrade,
                        # followed by a second deploy proving migration idempotency.
                        docker exec "$db_container" createdb -U uar_test uar_historical_upgrade
                        docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U uar_test -d uar_historical_upgrade < my-app/prisma/migrations/20260507000000_legacy_schema_bootstrap/migration.sql
                        docker compose -p "$test_project" -f "$test_compose" run --rm --no-deps \
                            -e DATABASE_URL='postgresql://uar_test:fixture-db-only@postgres:5432/uar_historical_upgrade?sslmode=disable' \
                            portal-migrate migrate resolve --applied 20260507000000_legacy_schema_bootstrap
                        docker compose -p "$test_project" -f "$test_compose" run --rm --no-deps \
                            -e DATABASE_URL='postgresql://uar_test:fixture-db-only@postgres:5432/uar_historical_upgrade?sslmode=disable' \
                            portal-migrate migrate deploy
                        docker compose -p "$test_project" -f "$test_compose" run --rm --no-deps \
                            -e DATABASE_URL='postgresql://uar_test:fixture-db-only@postgres:5432/uar_historical_upgrade?sslmode=disable' \
                            auth-migrate npx prisma migrate deploy
                        docker compose -p "$test_project" -f "$test_compose" run --rm --no-deps \
                            -e DATABASE_URL='postgresql://uar_test:fixture-db-only@postgres:5432/uar_historical_upgrade?sslmode=disable' \
                            portal-migrate migrate deploy

                        docker exec "$db_container" pg_dump -U uar_test -d uar_browser_test -Fc > "$restore_dump"
                        docker exec "$db_container" createdb -U uar_test uar_browser_restore
                        docker exec -i "$db_container" pg_restore -U uar_test -d uar_browser_restore --exit-on-error < "$restore_dump"
                        source_schema=$(docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U uar_test -d uar_browser_test < tools/migration-gate/schema-fingerprint.sql | tr -d '[:space:]')
                        restored_schema=$(docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U uar_test -d uar_browser_restore < tools/migration-gate/schema-fingerprint.sql | tr -d '[:space:]')
                        test -n "$source_schema"
                        test "$source_schema" = "$restored_schema"

                        # Simulate an evolved deployment created before the bootstrap
                        # migration was inserted into immutable history.
                        docker exec "$db_container" createdb -U uar_test uar_evolved_upgrade
                        docker exec -i "$db_container" pg_restore -U uar_test -d uar_evolved_upgrade --exit-on-error < "$restore_dump"
                        docker exec "$db_container" psql -X -v ON_ERROR_STOP=1 -U uar_test -d uar_evolved_upgrade \
                            -c "DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20260507000000_legacy_schema_bootstrap'" >/dev/null
                        docker compose -p "$test_project" -f "$test_compose" run --rm --no-deps \
                            -e DATABASE_URL='postgresql://uar_test:fixture-db-only@postgres:5432/uar_evolved_upgrade?sslmode=disable' \
                            portal-migrate migrate resolve --applied 20260507000000_legacy_schema_bootstrap
                        docker compose -p "$test_project" -f "$test_compose" run --rm --no-deps \
                            -e DATABASE_URL='postgresql://uar_test:fixture-db-only@postgres:5432/uar_evolved_upgrade?sslmode=disable' \
                            portal-migrate migrate deploy

                        # A partial/unknown schema must fail closed.
                        docker exec "$db_container" createdb -U uar_test uar_partial_schema
                        docker exec "$db_container" psql -X -v ON_ERROR_STOP=1 -U uar_test -d uar_partial_schema \
                            -c 'CREATE TABLE "AccessRequest" (id text PRIMARY KEY)' >/dev/null
                        if docker compose -p "$test_project" -f "$test_compose" run --rm --no-deps \
                            -e DATABASE_URL='postgresql://uar_test:fixture-db-only@postgres:5432/uar_partial_schema?sslmode=disable' \
                            portal-migrate migrate deploy; then
                            echo 'partial schema was unexpectedly accepted' >&2
                            exit 1
                        fi

                        cd my-app
                        npm ci --no-audit --no-fund
                        npx playwright install --with-deps chromium
                        npm run test:e2e
                    '''
                }
            }
        }

        stage('Release Review Required') {
            steps {
                echo 'Source and disposable-environment checks passed. Target backup/database preflight, runtime configuration validation, migration, and deployment require a separately authorized release process. CI images use placeholder public configuration and are not deployment artifacts.'
            }
        }
    }
    
    post {
        success {
            echo 'Branch validation successful; production readiness remains a separate gate.'
            // Add notification here (email, Slack, etc.)
        }
        
        failure {
            echo 'Branch validation failed; inspect the failed stage logs.'
        }
        
        always {
            echo 'Cleaning up workspace...'
            cleanWs()
        }
    }
}
