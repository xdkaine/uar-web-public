import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4402';

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results/playwright',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { outputFolder: 'test-results/playwright-report', open: 'never' }], ['line']] : 'line',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  expect: {
    toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.01 },
  },
  projects: [
    { name: 'desktop-light', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } },
    { name: 'desktop-dark-reduced', use: { ...devices['Desktop Chrome'], colorScheme: 'dark', contextOptions: { reducedMotion: 'reduce' } } },
    { name: 'mobile-light', use: { ...devices['Pixel 7'], colorScheme: 'light' } },
  ],
});
