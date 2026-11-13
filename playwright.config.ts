import { defineConfig, devices } from "@playwright/test";

const phonePort = Number(process.env.E2E_PORT) || 4173;
const featuresPort = phonePort + 1;

const sharedUse = {
  viewport: devices["iPhone 13"].viewport,
  userAgent: devices["iPhone 13"].userAgent,
  deviceScaleFactor: devices["iPhone 13"].deviceScaleFactor,
  isMobile: true,
  hasTouch: true,
  trace: "off" as const,
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
      name: "phone-webkit",
      testMatch: /phoneFlow.*\.spec\.ts/,
      use: {
        browserName: "webkit",
        viewport: { width: 390, height: 844 },
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
        baseURL: `http://127.0.0.1:${phonePort}`,
        trace: "off",
      },
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
        BETA_INVITE_RATE_LIMIT: "400",
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
        BETA_INVITE_RATE_LIMIT: "400",
        E2E_FEATURES: "1",
      },
    },
  ],
});
