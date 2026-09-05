import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CRON_ROUTE_REGISTRY, effectiveCronRouteRegistry } from './registry';

const cronRouteDir = fileURLToPath(new URL('../../app/api/cron', import.meta.url));
const repositoryComposePath = fileURLToPath(new URL('../../../docker-compose.yml', import.meta.url));
const composePath = existsSync(repositoryComposePath)
  ? repositoryComposePath
  : '/workspace-contract/docker-compose.yml';

describe('CRON_ROUTE_REGISTRY', () => {
  const originalWorkflowEnabled = process.env.WORKFLOW_TICK_ENABLED;
  const originalWorkflowInterval = process.env.WORKFLOW_TICK_INTERVAL_SECONDS;

  afterEach(() => {
    if (originalWorkflowEnabled === undefined) delete process.env.WORKFLOW_TICK_ENABLED;
    else process.env.WORKFLOW_TICK_ENABLED = originalWorkflowEnabled;
    if (originalWorkflowInterval === undefined) delete process.env.WORKFLOW_TICK_INTERVAL_SECONDS;
    else process.env.WORKFLOW_TICK_INTERVAL_SECONDS = originalWorkflowInterval;
  });
  it('registers exactly the cron routes that exist under app/api/cron', () => {
    for (const entry of CRON_ROUTE_REGISTRY) {
      expect(
        existsSync(`${cronRouteDir}/${entry.route}/route.ts`),
        `${entry.route} must have app/api/cron/${entry.route}/route.ts`
      ).toBe(true);
    }
  });

  it('gives every sidecar-backed job a unique *_ENABLED toggle', () => {
    const toggles = CRON_ROUTE_REGISTRY.map((entry) => entry.enabledEnvKey).filter(
      (key): key is string => key !== null
    );

    expect(new Set(toggles).size).toBe(toggles.length);
    for (const toggle of toggles) {
      expect(toggle.endsWith('_ENABLED')).toBe(true);
    }
  });

  it('keeps expected cadences positive so staleness detection works', () => {
    for (const entry of CRON_ROUTE_REGISTRY) {
      expect(entry.expectedIntervalSeconds).toBeGreaterThan(0);
      expect(Number.isInteger(entry.expectedIntervalSeconds)).toBe(true);
    }
  });

  it('uses effective enablement and bounded runtime cadence overrides', () => {
    process.env.WORKFLOW_TICK_ENABLED = 'true';
    process.env.WORKFLOW_TICK_INTERVAL_SECONDS = '180';
    const workflow = effectiveCronRouteRegistry().find((entry) => entry.route === 'workflow-tick');
    expect(workflow).toMatchObject({ enabled: true, expectedIntervalSeconds: 180 });

    process.env.WORKFLOW_TICK_ENABLED = 'false';
    process.env.WORKFLOW_TICK_INTERVAL_SECONDS = 'not-a-number';
    const disabled = effectiveCronRouteRegistry().find((entry) => entry.route === 'workflow-tick');
    expect(disabled).toMatchObject({ enabled: false, expectedIntervalSeconds: 60 });
  });

  it('forwards every scheduler toggle and cadence into the app container', () => {
    const compose = readFileSync(composePath, 'utf8');
    const appEnvironment = compose.match(/\n  app:\n([\s\S]*?)\n  monitor-probe:/)?.[1] ?? '';
    expect(appEnvironment).not.toBe('');

    for (const descriptor of CRON_ROUTE_REGISTRY) {
      for (const key of [descriptor.enabledEnvKey, descriptor.intervalEnvKey]) {
        if (!key) continue;
        expect(appEnvironment, `${key} must be forwarded into services.app.environment`)
          .toContain(`${key}:`);
      }
    }
  });
});
