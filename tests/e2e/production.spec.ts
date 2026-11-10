// End-to-end checks against the PRODUCTION build (dist/), which has no host permissions.
//
// Access to a page can only come from a real invocation of the extension, so these tests
// click the actual toolbar button through the DevTools protocol (Extensions.triggerAction)
// instead of relying on the test-only host permissions used by the other suites.
import { test as base, chromium, expect, type BrowserContext, type CDPSession, type Page, type Worker } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIST = path.resolve(import.meta.dirname, '..', '..', 'dist');
const SITE = `http://127.0.0.1:${process.env.ROWLIO_E2E_PORT || 4173}`;

interface Fixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  browserSession: CDPSession;
  /** Click Rowlio's toolbar button on the tab showing `page` (grants activeTab, opens the popup). */
  clickToolbarIcon: (page: Page) => Promise<void>;
}

const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    if (!fs.existsSync(path.join(DIST, 'manifest.json'))) throw new Error('dist/ is missing. Run `npm run build` first.');
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rowlio-prod-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      acceptDownloads: true,
      env: { ...(process.env as Record<string, string>), LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
      viewport: { width: 1360, height: 860 },
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--enable-unsafe-extension-debugging'],
    });
    await use(context);
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },
  serviceWorker: async ({ context }, use) => {
    await use(context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker')));
  },
  browserSession: async ({ context }, use) => {
    const browser = context.browser();
    if (!browser) throw new Error('No browser handle for the persistent context');
    await use(await browser.newBrowserCDPSession());
  },
  clickToolbarIcon: async ({ browserSession, serviceWorker }, use) => {
    const extensionId = new URL(serviceWorker.url()).host;
    await use(async (page) => {
      await page.bringToFront();
      const { targetInfos } = (await browserSession.send('Target.getTargets', { filter: [{ type: 'tab' }] })) as { targetInfos: { type: string; url: string; targetId: string }[] };
      const tab = targetInfos.find((info) => info.type === 'tab' && info.url === page.url());
      if (!tab) throw new Error(`No tab target for ${page.url()}`);
      await browserSession.send('Extensions.triggerAction' as never, { id: extensionId, targetId: tab.targetId } as never);
    });
  },
});

/** Can the extension run a script in the tab that is currently in front? */
async function canScriptActiveTab(serviceWorker: Worker): Promise<{ ok: boolean; tabId: number; error?: string }> {
  return serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: () => document.title });
      return { ok: true, tabId: tab.id! };
    } catch (error) {
      return { ok: false, tabId: tab.id!, error: String(error) };
    }
  });
}

async function workspaceFor(context: BrowserContext, serviceWorker: Worker, tabId: number, hash: string): Promise<Page> {
  // The workspace tab opened at install time is reused, as in real use.
  const app = context.pages().find((page) => page.url().includes('/app.html')) ?? (await context.newPage());
  await app.goto(`chrome-extension://${new URL(serviceWorker.url()).host}/app.html?tab=${tabId}${hash}`);
  // A fresh profile always starts with the introduction.
  const skip = app.getByTestId('onboarding-skip');
  await skip.waitFor({ state: 'visible', timeout: 10_000 });
  await skip.click();
  await expect(app.locator('html')).not.toHaveAttribute('data-saving', 'true');
  return app;
}

test.describe('production build with real permissions', () => {
  test('has no access to a page until the toolbar button is clicked there', async ({ context, serviceWorker, clickToolbarIcon, browserSession }) => {
    const target = await context.newPage();
    await target.goto(`${SITE}/tables`);
    await target.bringToFront();

    const before = await canScriptActiveTab(serviceWorker);
    expect(before.ok).toBe(false);
    expect(before.error).toMatch(/Cannot access contents of the page/);
    // Nothing was injected into the page either.
    expect(await target.evaluate(() => document.querySelector('[data-rowlio-overlay]'))).toBeNull();

    await clickToolbarIcon(target);
    await expect.poll(async () => (await canScriptActiveTab(serviceWorker)).ok).toBe(true);

    // The real popup opened.
    await expect
      .poll(async () => {
        const { targetInfos } = (await browserSession.send('Target.getTargets', { filter: [{}] })) as { targetInfos: { url: string }[] };
        return targetInfos.some((info) => info.url.endsWith('/popup.html'));
      })
      .toBe(true);
  });

  test('after one click the workspace can extract tables, and access follows the site only', async ({ context, serviceWorker, clickToolbarIcon }) => {
    const target = await context.newPage();
    await target.goto(`${SITE}/tables`);
    await clickToolbarIcon(target);
    await expect.poll(async () => (await canScriptActiveTab(serviceWorker)).ok).toBe(true);
    const { tabId } = await canScriptActiveTab(serviceWorker);

    const app = await workspaceFor(context, serviceWorker, tabId, '#/tables');
    await expect(app.getByTestId('topbar')).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
    await expect(app.getByTestId('table-card')).toHaveCount(6, { timeout: 15_000 });
    await app.getByTestId('extract-table').first().click();
    await expect(app.getByTestId('row-count')).toHaveText('4 rows');

    // Same site, another page: access persists and the workspace reconnects by itself.
    await target.goto(`${SITE}/products`);
    await expect(app.getByTestId('target-title')).toHaveText('Products – page 1', { timeout: 15_000 });
    await expect(app.getByTestId('topbar')).toHaveAttribute('data-status', 'ready');

    // A different site: Chrome withdraws the temporary access and Rowlio says so.
    const elsewhere = `${SITE.replace('127.0.0.1', '127.0.0.2')}/tables`;
    const reachable = await target
      .goto(elsewhere)
      .then((response) => !!response?.ok())
      .catch(() => false);
    test.skip(!reachable, '127.0.0.2 is not routable in this environment');
    await expect(app.getByTestId('topbar')).toHaveAttribute('data-status', 'no-access', { timeout: 15_000 });
    // Chrome hides the new address, so Rowlio must not keep showing (or offering to
    // unlock) the old site: it asks for a fresh click on that tab instead.
    await expect(app.getByTestId('target-title')).toHaveText('The tab moved to another site');
    await expect(app.getByTestId('topbar')).toContainText('Click the Rowlio icon on that tab');
    await expect(app.getByRole('button', { name: /Grant access/ })).toHaveCount(0);
    // Data extracted earlier is untouched.
    await app.goto(app.url().replace(/#.*/, '#/data'));
    await expect(app.getByTestId('row-count')).toHaveText('4 rows');
  });

  test('pagination across page loads works with click-granted access only', async ({ context, serviceWorker, clickToolbarIcon }) => {
    const target = await context.newPage();
    await target.goto(`${SITE}/products`);
    await clickToolbarIcon(target);
    await expect.poll(async () => (await canScriptActiveTab(serviceWorker)).ok).toBe(true);
    const { tabId } = await canScriptActiveTab(serviceWorker);

    const app = await workspaceFor(context, serviceWorker, tabId, '#/visual');
    await app.getByTestId('use-pattern').first().click();
    await expect(app.getByTestId('rule-preview')).toContainText('9 records on this page');
    await app.getByRole('button', { name: 'Extract multiple pages…' }).click();
    await app.getByTestId('delay-ms').fill('0');
    await app.getByTestId('start-run').click();
    const summary = app.getByTestId('run-summary');
    await expect(summary).toBeVisible({ timeout: 45_000 });
    await expect(summary).toContainText('27 records collected from 3 pages');

    // The in-page overlay is sealed in production: page scripts cannot reach inside it.
    await app.goto(app.url().replace(/#.*/, '#/visual'));
    await app.getByTestId('start-picker').click();
    await expect.poll(() => target.evaluate(() => !!document.querySelector('[data-rowlio-overlay]'))).toBe(true);
    expect(await target.evaluate(() => document.querySelector('[data-rowlio-overlay]')!.shadowRoot)).toBeNull();
  });
});
