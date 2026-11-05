import { defineConfig, devices } from "@playwright/test";

const phonePort = Number(process.env.E2E_PORT) || 4173;
const featuresPort = phonePort + 1;

const sharedUse = {
  viewport: devices["iPhone 13"].viewport,
  userAgent: devices["iPhone 13"].userAgent,
  deviceScaleFactor: devices["iPhone 13"].deviceScaleFactor,
  isMobile: true,
  hasTouch: true,
  trace: "retain-on-failure" as const,
};

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: "e2e-artifacts/output",
  reporter: [["list"]],
  projects: [
    {
      name: "phone",
      testIgnore: /features\.spec\.ts/,
      use: { ...sharedUse, baseURL: `http://127.0.0.1:${phonePort}` },
    },
    {
      name: "features",
      testMatch: /features\.spec\.ts/,
      use: {
        ...sharedUse,
        baseURL: `http://127.0.0.1:${featuresPort}`,
        permissions: ["notifications"],
      },
    },
  ],
  webServer: [
    {
      command: "npx tsx e2e/server.ts",
      url: `http://127.0.0.1:${phonePort}/api/health/ready`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        PORT: String(phonePort),
        BETA_INVITE_CODES: "Brandon-50y4",
        E2E_FEATURES: "",
      },
    },
    {
      command: "npx tsx e2e/server.ts",
      url: `http://127.0.0.1:${featuresPort}/api/health/ready`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        PORT: String(featuresPort),
        BETA_INVITE_CODES: "Brandon-50y4",
        E2E_FEATURES: "1",
      },
    },
  ],
});
