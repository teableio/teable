// @ts-check

import path from 'path';
import { loadEnvConfig } from '@next/env';
import type { PlaywrightTestConfig } from '@playwright/test';
import { devices } from '@playwright/test';
import pc from 'picocolors';

const webServerModes = ['DEV', 'START', 'BUILD_AND_START'] as const;
type IWebServerMode = (typeof webServerModes)[number];

const isCI = ['true', '1'].includes(process.env?.CI ?? '');
const webServerMode = (process.env?.E2E_WEBSERVER_MODE as IWebServerMode) ?? 'NOT_SET';

const webServerPort = 3000;
const outputDir = path.join(__dirname, 'e2e/.out');

type IWebServerConfig = { cmd: string; timeout: number; retries: number };
const webServerConfigs: Record<IWebServerMode, IWebServerConfig> = {
  START: {
    cmd: `yarn start -p ${webServerPort}`,
    timeout: isCI ? 90_000 : 30_000,
    retries: isCI ? 3 : 1,
  },
  DEV: {
    cmd: `yarn dev -p ${webServerPort}`,
    timeout: 30_000,
    retries: 1,
  },
  BUILD_AND_START: {
    cmd: `NEXT_IGNORE_TYPECHECKS=1 yarn build --no-lint && yarn start -p ${webServerPort}`,
    timeout: isCI ? 180_000 : 120_000,
    retries: isCI ? 3 : 1,
  },
};

if (typeof webServerConfigs?.[webServerMode] !== 'object') {
  console.error(
    `${pc.red('error')} - E2E_WEBSERVER_MODE must be one of '${webServerModes.join(', ')}'`
  );
  process.exit(1);
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
  timeout: webServerConfig.timeout,
  retries: webServerConfig.retries,
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
  webServer: {
    command: webServerConfig.cmd,
    port: webServerPort,
    timeout: webServerConfig.timeout,
    reuseExistingServer: !isCI,
    env: getNextJsEnv(),
  },

  use: {
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
