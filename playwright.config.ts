import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.KLECKS_BASE_URL || 'http://localhost:1234';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false, // shared backend state (sqlite)
    workers: 1,
    retries: 0,
    timeout: 30_000,
    use: {
        baseURL,
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'klecks-ipad',
            use: { ...devices['iPad (gen 7) landscape'] },
            testMatch: /klecks-.*\.spec\.ts$/,
        },
        {
            name: 'peer-iphone-se',
            use: { ...devices['iPhone SE'] },
            testMatch: /peer-.*\.spec\.ts$/,
        },
        {
            name: 'cross-device',
            testMatch: /cross-.*\.spec\.ts$/,
        },
        {
            name: 'smoke',
            use: { ...devices['Desktop Chrome'] },
            testMatch: /smoke\.spec\.ts$/,
        },
    ],
});
