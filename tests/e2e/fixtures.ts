// Playwright fixtures: a Chromium profile with the E2E build of the extension loaded,
// plus helpers to open a fixture page and a workspace connected to it.
import { test as base, chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export const SITE = `http://127.0.0.1:${process.env.ROWLIO_E2E_PORT || 4173}`;
const EXTENSION_DIR = path.resolve(import.meta.dirname, '..', '..', 'dist-e2e');

interface Fixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  /** Open a fixture page and a workspace bound to it. */
  connect: (pathname: string, hash?: string) => Promise<{ target: Page; app: Page; tabId: number }>;
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    if (!fs.existsSync(path.join(EXTENSION_DIR, 'manifest.json'))) {
      throw new Error('dist-e2e/ is missing. Run `npm run build:e2e` first.');
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rowlio-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      acceptDownloads: true,
      viewport: { width: 1360, height: 860 },
      args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
    });
    await use(context);
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },

  serviceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },

  connect: async ({ context, serviceWorker, extensionId }, use) => {
    await use(async (pathname, hash = '#/') => {
      const target = await context.newPage();
      await target.goto(`${SITE}${pathname}`);
      const tabId = await serviceWorker.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((candidate) => candidate.url === url);
        if (!tab || tab.id === undefined) throw new Error(`No tab for ${url}`);
        return tab.id;
      }, target.url());
      const app = await context.newPage();
      await app.goto(`chrome-extension://${extensionId}/app.html?tab=${tabId}${hash}`);
      await expect(app.getByTestId('topbar')).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
      return { target, app, tabId };
    });
  },
});

export { expect };

/** The extension opens its welcome tab on install; close it so tests start clean. */
export async function closeWelcomeTabs(context: BrowserContext): Promise<void> {
  for (const page of context.pages()) {
    if (page.url().startsWith('chrome-extension://')) await page.close().catch(() => undefined);
  }
}
