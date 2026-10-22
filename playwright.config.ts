import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
// tests/e2e/worker.spec.ts checks the built site as the Cloudflare Worker serves it: by default
// `npx wrangler dev --port 8788` after `npm run build`, or a deployed URL (WORKER_URL, else
// BASE_URL, as Task 20 checks the workers.dev preview).
const WORKER_URL = process.env.WORKER_URL ?? process.env.BASE_URL ?? 'http://localhost:8788';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: BASE_URL, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /worker\.spec\.ts$/ },
    { name: 'worker', use: { ...devices['Desktop Chrome'], baseURL: WORKER_URL }, testMatch: /worker\.spec\.ts$/ },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : { command: 'npm run dev -- --port 5173 --strictPort', url: BASE_URL, reuseExistingServer: true },
});
