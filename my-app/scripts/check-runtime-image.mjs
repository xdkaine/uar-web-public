/** Inspect a completed application runner without loading credentials or starting services. */
import { readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(process.argv[2] || '/app');
const kind = process.argv[3];
if (!['portal', 'auth'].includes(kind)) {
  throw new Error('Usage: node check-runtime-image.mjs <image-app-directory> <portal|auth>');
}
const forbidden = [];
let inspected = 0;
async function inspect(directory, relative = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    // Dependencies legitimately contain declarations, licenses and package metadata.
    // Their integrity is checked through the lockfile, audit and import smoke tests.
    if (entry.name === 'node_modules') continue;
    if (/^\.env/.test(entry.name)
      || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)
      || /\.(?:tsx?|mdx?|tsbuildinfo)$/.test(entry.name)
      || /^(?:app|components|hooks|lib|src|scripts|types|e2e|tests|fixtures|docs|prisma|\.agent|\.agents)(?:\/|$)/.test(name)
      || /(?:^|\/)(?:__tests__|__fixtures__|test-results|playwright-report)(?:\/|$)/.test(name)
      || /^(?:package-lock\.json|\.npmrc|(?:eslint|postcss|playwright|vitest)\.config\.|tsconfig)/.test(name)) {
      forbidden.push(name);
    }
    if (entry.isDirectory()) await inspect(path.join(directory, entry.name), name);
    else inspected++;
  }
}
await inspect(root);
if (forbidden.length) {
  console.error(`Runtime packaging rejected ${forbidden.length} project paths:\n${forbidden.slice(0, 50).join('\n')}`);
  process.exit(1);
}
const required = kind === 'portal'
  ? ['server.js', '.next/server', '.next/static', 'public', 'runtime-validation/scripts/runtime-entrypoint.js']
  : ['dist/index.js'];
for (const item of required) await access(path.join(root, item));
const require = createRequire(path.join(root, 'package.json'));
// Match Next's startup order before loading a route's async request context.
if (kind === 'portal') require('next/dist/server/node-environment');
for (const dependency of kind === 'portal'
  ? ['next', 'react', 'pg', '@prisma/client', '@prisma/adapter-pg']
  : ['pg', '@prisma/client', '@prisma/adapter-pg', 'ldapts', 'oidc-provider', 'redis', 'sanitize-html']) {
  require.resolve(dependency);
  // Load modules that have no service-start side effects; OIDC provider is ESM.
  if (dependency !== 'oidc-provider') require(dependency);
}
// Make sure the generated Prisma client is loadable, not merely the package stub.
if (typeof require('@prisma/client').PrismaClient !== 'function') {
  throw new Error('Generated Prisma client is missing');
}
// Import a compiled route, not only package entrypoints: bundler aliases can be
// missing even when direct dependency imports succeed. This does not serve a request.
if (kind === 'portal') require(path.join(root, '.next/server/app/login/page.js'));
console.log(`${kind} runtime packaging passed: ${inspected} project files; required assets and dependency imports present`);
