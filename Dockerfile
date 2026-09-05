# syntax=docker/dockerfile:1.6
# Multi-stage Dockerfile for Next.js application
FROM node:22-alpine AS base

RUN apk add --no-cache libc6-compat
RUN npm install -g npm@11.14.1
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps

# Copy package files
COPY my-app/.npmrc my-app/package.json my-app/package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM base AS builder
WORKDIR /app

# Reuse dependencies from the cached deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy Prisma config and schema separately for better layer caching
COPY my-app/prisma.config.ts ./prisma.config.ts
COPY my-app/prisma ./prisma
RUN npx prisma generate

# Copy the rest of the application source after Prisma generation
COPY my-app/ .
COPY docker-compose.yml /workspace-contract/docker-compose.yml

# Define build arguments for public variables with defaults for build
ARG NEXT_PUBLIC_APP_URL="http://localhost:3002"
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY="1x00000000000000000000AA"

# Set environment variables for build time (Next.js inlines NEXT_PUBLIC_ vars)
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY

# Set dummy environment variables to satisfy build-time validation
# These are NOT persisted to the final image, only used for 'npm run build'
# Set dummy environment variables to satisfy build-time validation
# These are NOT persisted to the final image, only used for 'npm run build'
ARG DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy?sslmode=require"
ARG SMTP_HOST="dummy"
ARG SMTP_PORT="587"
ARG SMTP_USER="dummy"
ARG SMTP_PASSWORD="dummy"
ARG EMAIL_FROM="dummy"
ARG ADMIN_EMAIL="dummy"
ARG LDAP_URL="ldaps://dummy"
ARG LDAP_BIND_DN="dummy"
ARG LDAP_BIND_PASSWORD="dummy"
ARG LDAP_SEARCH_BASE="dummy"
ARG LDAP_DOMAIN="dummy"
ARG LDAP_ADMIN_GROUPS='["CN=Build Admins,OU=Groups,DC=example,DC=invalid"]'
ARG LDAP_GROUP2ADD="dummy"
ARG NEXTAUTH_SECRET="dummy_secret_at_least_32_chars_long_12345"
ARG ENCRYPTION_SECRET="dummy_secret_at_least_32_chars_long_12345"
ARG ENCRYPTION_SALT="dummy_salt_at_least_32_chars_long_12345"
ARG TURNSTILE_SECRET_KEY="dummy"
ARG MONITOR_PROBE_SHARED_SECRET="dummy_monitor_probe_secret_at_least_32_chars"
ARG LDAP_KAMINO_INTERNAL_GROUP="dummy"
ARG LDAP_KAMINO_EXTERNAL_GROUP="dummy"
ARG LDAP_GROUPSEARCH="dummy"

# Make ARGs available as ENV vars during build only
ENV DATABASE_URL=$DATABASE_URL \
    SMTP_HOST=$SMTP_HOST \
    SMTP_PORT=$SMTP_PORT \
    SMTP_USER=$SMTP_USER \
    SMTP_PASSWORD=$SMTP_PASSWORD \
    EMAIL_FROM=$EMAIL_FROM \
    ADMIN_EMAIL=$ADMIN_EMAIL \
    LDAP_URL=$LDAP_URL \
    LDAP_BIND_DN=$LDAP_BIND_DN \
    LDAP_BIND_PASSWORD=$LDAP_BIND_PASSWORD \
    LDAP_SEARCH_BASE=$LDAP_SEARCH_BASE \
    LDAP_DOMAIN=$LDAP_DOMAIN \
    LDAP_ADMIN_GROUPS=$LDAP_ADMIN_GROUPS \
    LDAP_GROUP2ADD=$LDAP_GROUP2ADD \
    NEXTAUTH_SECRET=$NEXTAUTH_SECRET \
    ENCRYPTION_SECRET=$ENCRYPTION_SECRET \
    ENCRYPTION_SALT=$ENCRYPTION_SALT \
    TURNSTILE_SECRET_KEY=$TURNSTILE_SECRET_KEY \
    MONITOR_PROBE_SHARED_SECRET=$MONITOR_PROBE_SHARED_SECRET

# Build Next.js application
RUN npm run build
RUN ./node_modules/.bin/tsc \
    --target ES2022 \
    --module CommonJS \
    --moduleResolution Node \
    --esModuleInterop \
    --skipLibCheck \
    --noEmit false \
    --outDir /runtime-validation \
    scripts/runtime-entrypoint.ts \
    lib/env-validator.ts \
    lib/ldap/admin-groups.ts

FROM base AS prisma-tool
WORKDIR /app
RUN apk add --no-cache postgresql-client
COPY tools/database-role-separation /opt/uar/database-role-separation

COPY --from=deps /app/node_modules ./node_modules
COPY my-app/prisma.config.ts ./prisma.config.ts
COPY my-app/prisma ./prisma

ENTRYPOINT ["./node_modules/.bin/prisma"]
CMD ["--help"]

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Runtime environment variables for Turnstile (will be overridden by docker-compose)
ENV TURNSTILE_SECRET_KEY=""
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=""

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /runtime-validation ./runtime-validation

# Fail the image build if tracing reintroduces source, tests, docs or env files.
RUN --mount=type=bind,source=my-app/scripts/check-runtime-image.mjs,target=/tmp/check-runtime-image.mjs \
    node /tmp/check-runtime-image.mjs /app portal

# Ensure proper permissions for public directory
RUN chown -R nextjs:nodejs /app/public && \
    chmod -R 755 /app/public

USER 1001:1001

EXPOSE 3002

ENV PORT=3002
ENV HOSTNAME="0.0.0.0"

# Validate the actual runtime environment before starting the application.
CMD ["node", "runtime-validation/scripts/runtime-entrypoint.js"]
