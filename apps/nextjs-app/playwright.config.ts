// @ts-check

import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { PlaywrightTestConfig } from '@playwright/test';
import { devices } from '@playwright/test';
import pc from 'picocolors';

const webServerModes = ['DEV', 'START', 'BUILD_AND_START'] as const;
type IWebServerMode = (typeof webServerModes)[number];

const isCI = ['true', '1'].includes(process.env?.CI ?? '');
const webServerMode = (process.env?.E2E_WEBSERVER_MODE as IWebServerMode) ?? 'DEV';

// E2E_BASE_URL points the suite at an already-running instance (a manually
// started local stack, a preview/deployed instance). Without it Playwright
// starts and stops the local stack itself (see webServer below).
const externalBaseUrl = process.env?.E2E_BASE_URL;

const webServerPort = Number(process.env?.E2E_WEB_SERVER_PORT ?? process.env?.PORT ?? 3000);
// 127.0.0.1 rather than localhost: next.config.js allow-lists it explicitly and
// it sidesteps the IPv6/IPv4 split of `localhost` on Windows.
const webServerUrl = `http://127.0.0.1:${webServerPort}`;

// Drive the locally installed Google Chrome (the browser the rest of the
// toolchain uses). Override with E2E_BROWSER_CHANNEL — e.g. `chromium` on CI
// images that only carry the bundled browser.
const browserChannel = process.env?.E2E_BROWSER_CHANNEL || 'chrome';

const outputDir = path.join(__dirname, 'e2e/.out');

/**
 * There is no standalone `next dev` / `next start` script in apps/nextjs-app:
 * the Nest backend (apps/nestjs-backend) mounts the Next.js app on PORT, so
 * every mode boots the backend. Runbook: apps/nextjs-app/e2e/README.md.
 */
type IWebServerConfig = {
  cmd: string;
  /** Per-test timeout while this suite owns the server. */
  testTimeout: number;
  /** How long Playwright waits for the server before failing. */
  serverTimeout: number;
  retries: number;
};
const webServerConfigs: Record<IWebServerMode, IWebServerConfig> = {
  DEV: {
    cmd: `pnpm -F @teable/backend dev`,
    testTimeout: 90_000,
    serverTimeout: 300_000,
    retries: 1,
  },
  START: {
    cmd: `pnpm -F @teable/backend start`,
    testTimeout: 60_000,
    serverTimeout: 300_000,
    retries: isCI ? 3 : 1,
  },
  BUILD_AND_START: {
    cmd: `pnpm -F @teable/app build-fast && pnpm -F @teable/backend build && pnpm -F @teable/backend start`,
    testTimeout: 90_000,
    serverTimeout: 900_000,
    retries: isCI ? 3 : 1,
  },
};

if (typeof webServerConfigs?.[webServerMode] !== 'object') {
  console.error(
    `${pc.red('error')} - E2E_WEBSERVER_MODE must be one of '${webServerModes.join(', ')}'`
  );
  process.exit(1);
} else if (externalBaseUrl) {
  console.log(
    `${pc.green('notice')} - E2E_BASE_URL is set ('${externalBaseUrl}'); no server will be started`
  );
} else {
  console.log(`${pc.green('notice')} - Using E2E_WEBSERVER_MODE: '${webServerMode}'`);
}

const webServerConfig = webServerConfigs[webServerMode];

function getNextJsEnv(): Record<string, string> {
  const { combinedEnv, loadedEnvFiles } = loadEnvConfig(__dirname);
  loadedEnvFiles.forEach((file) => {
    console.log(`${pc.green('notice')}- Loaded nextjs environment file: './${file.path}'`);
  });
  return Object.keys(combinedEnv).reduce<Record<string, string>>((acc, key) => {
    const v = combinedEnv[key];
    if (v !== undefined) acc[key] = v;
    return acc;
  }, {});
}

// Reference: https://playwright.dev/docs/test-configuration
/**
 * @type {Partial<import('@playwright/test').PlaywrightTestConfig>}
 */
const config: PlaywrightTestConfig = {
  testDir: path.join(__dirname, 'e2e'),
  /* Maximum time one test can run for. */
  timeout: webServerConfig.testTimeout,
  retries: webServerConfig.retries,
  /* Dev-mode first visits compile pages on demand; give assertions room. */
  expect: {
    timeout: 15_000,
  },
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  // Artifacts folder where screenshots, videos, and traces are stored.
  outputDir: `${outputDir}/output`,
  preserveOutput: 'always',
  reporter: [
    isCI ? ['github'] : ['list'],
    ['json', { outputFile: `${outputDir}/reports/test-results.json` }],
    [
      'html',
      {
        outputFolder: `${outputDir}/reports/html`,
        open: isCI ? 'never' : 'on-failure',
      },
    ],
  ],

  // https://playwright.dev/docs/test-advanced#launching-a-development-web-server-during-the-tests
  webServer: externalBaseUrl
    ? undefined
    : {
        command: webServerConfig.cmd,
        port: webServerPort,
        timeout: webServerConfig.serverTimeout,
        reuseExistingServer: !isCI,
        env: getNextJsEnv(),
      },

  use: {
    baseURL: externalBaseUrl ?? webServerUrl,
    // Retry a test if it's failing with enabled tracing. This allows you to analyse the DOM, console logs, network traffic etc.
    // More information: https://playwright.dev/docs/trace-viewer
    trace: 'retry-with-trace',

    contextOptions: {
      ignoreHTTPSErrors: true,
    },
  },

  projects: [
    {
      name: 'Desktop Chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: browserChannel,
      },
    },
    // {
    //  name: 'Desktop Firefox',
    //  use: {
    //    ...devices['Desktop Firefox'],
    //  },
    // },
    // {
    //  name: 'Desktop Safari',
    //  use: {
    //    ...devices['Desktop Safari'],
    //  },
    // },
    // Test against mobile viewports.
    {
      name: 'Mobile Chrome',
      use: {
        ...devices['Pixel 5'],
        channel: browserChannel,
      },
    },
    // Mobile Safari is not supported on CI/Linux yet.
    // {
    //  name: 'Mobile Safari',
    //  use: devices['iPhone 12'],
    // },
  ],
};
export default config;
