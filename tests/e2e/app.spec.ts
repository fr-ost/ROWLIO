import fs from 'node:fs';
import { test, expect, dismissOnboarding, settingsSaved, SITE } from './fixtures';

test.describe('projects and recipes', () => {
  test('save a project, reopen it after a reload, rename and delete it', async ({ connect }) => {
    const { app } = await connect('/tables', '#/tables');
    await app.getByTestId('extract-table').nth(1).click();
    await expect(app.getByTestId('row-count')).toHaveText('3 rows');
    await expect(app.getByTestId('save-state')).toHaveText('Not saved yet');

    await app.getByTestId('save-project').click();
    await app.getByTestId('project-name').fill('বাংলা প্রকল্প');
    await app.getByLabel('Folder').fill('Research');
    await app.getByTestId('save-project-confirm').click();
    await expect(app.getByTestId('save-state')).toContainText('saved');

    // Nothing is kept in memory across a reload: the project must come from IndexedDB.
    await app.reload();
    await app.goto(app.url().replace(/#.*/, '#/projects'));
    const row = app.getByTestId('project-row');
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('project-title')).toHaveText('বাংলা প্রকল্প');
    await expect(row).toContainText('3 rows');
    await expect(row).toContainText('Research');

    await app.getByTestId('project-search').fill('nothing-like-this');
    await expect(app.getByText('No projects match')).toBeVisible();
    await app.getByTestId('project-search').fill('বাংলা');
    await expect(row).toHaveCount(1);

    await row.getByTestId('open-project').click();
    await expect(app.getByTestId('row-count')).toHaveText('3 rows');
    await expect(app.getByTestId('data-grid')).toContainText('রহিম উদ্দিন');
    await expect(app.getByTestId('data-grid')).toContainText('=SUM(A1:A2)');

    // Rename.
    await app.goto(app.url().replace(/#.*/, '#/projects'));
    await app.getByTestId('project-menu').click();
    await app.getByRole('menuitem', { name: 'Rename / move…' }).click();
    await app.getByTestId('edit-project-name').fill('Renamed project');
    await app.getByTestId('edit-project-save').click();
    await expect(app.getByTestId('project-title')).toHaveText('Renamed project');

    // Export the portable project file.
    await app.getByTestId('project-menu').click();
    const download = app.waitForEvent('download');
    await app.getByRole('menuitem', { name: /project file \(backup\)/ }).click();
    const file = await download;
    const exported = JSON.parse(fs.readFileSync(await file.path(), 'utf8'));
    expect(exported.format).toBe('rowlio-project');
    expect(exported.datasets[0].rows).toHaveLength(3);

    // Delete, with confirmation.
    await app.getByTestId('project-menu').click();
    await app.getByRole('menuitem', { name: 'Delete…' }).click();
    await app.getByRole('button', { name: 'Delete project' }).click();
    await expect(app.getByText('No saved projects yet')).toBeVisible();

    // Import the file back.
    await app.getByTestId('project-file-input').setInputFiles(await file.path());
    await expect(app.getByTestId('project-title')).toHaveText('Renamed project');
  });

  test('save a recipe and reuse it on a similar page', async ({ connect }) => {
    const { app, target } = await connect('/products', '#/visual');
    await app.getByTestId('use-pattern').first().click();
    await expect(app.getByTestId('rule-preview')).toContainText('9 records on this page');
    await app.getByTestId('save-recipe').click();
    await app.getByTestId('recipe-name').fill('Product listing');
    await expect(app.getByTestId('recipe-pattern')).toHaveValue(`${SITE}/*`);
    await app.getByTestId('recipe-save-confirm').click();
    await expect(app.getByTestId('toasts')).toContainText('Recipe “Product listing” saved');

    // A different page of the same listing: the recipe is offered on Home and works.
    await target.goto(`${SITE}/products?page=2`);
    await app.reload();
    await expect(app.getByTestId('topbar')).toHaveAttribute('data-status', 'ready');
    await app.goto(app.url().replace(/#.*/, '#/'));
    const offered = app.getByTestId('matching-recipes');
    await expect(offered).toContainText('Product listing');
    await offered.getByRole('button', { name: 'Run' }).click();
    await expect(app.getByTestId('row-count')).toHaveText('9 rows');
    await expect(app.getByTestId('data-grid')).toContainText('Product 10');

    // It is listed, and can be deleted.
    await app.goto(app.url().replace(/#.*/, '#/recipes'));
    await expect(app.getByTestId('recipe-row')).toContainText('Matches the connected page');
    await app.getByTestId('recipe-menu').click();
    await app.getByRole('menuitem', { name: 'Delete…' }).click();
    await app.getByRole('button', { name: 'Delete recipe' }).click();
    await expect(app.getByText('No recipes yet')).toBeVisible();
  });

  test('a recipe with pagination pre-fills the pagination screen', async ({ connect }) => {
    const { app } = await connect('/products', '#/visual');
    await app.getByTestId('use-pattern').first().click();
    await app.getByRole('button', { name: 'Extract multiple pages…' }).click();
    await app.getByTestId('max-pages').fill('2');
    await app.getByTestId('delay-ms').fill('0');
    await app.getByTestId('start-run').click();
    await expect(app.getByTestId('run-summary')).toContainText('18 records collected from 2 pages', { timeout: 45_000 });
    await app.getByTestId('save-pagination-recipe').click();
    await app.getByTestId('recipe-name').fill('Two pages of products');
    await app.getByTestId('recipe-save-confirm').click();

    await app.goto(app.url().replace(/#.*/, '#/recipes'));
    await expect(app.getByTestId('recipe-row')).toContainText('Up to 2 pages');
    await app.getByTestId('run-recipe').click();
    // Nothing runs by itself: the user lands on Pagination with the limits filled in.
    await expect(app.getByTestId('max-pages')).toHaveValue('2');
    await expect(app.getByTestId('start-run')).toBeEnabled();
  });
});

test.describe('shell', () => {
  test('first-run onboarding can be stepped through and does not come back', async ({ context, extensionId }) => {
    const app = await context.newPage();
    await app.goto(`chrome-extension://${extensionId}/app.html#/`);
    const dialog = app.getByTestId('onboarding');
    await expect(dialog).toContainText('Extract tables in one click');
    for (const heading of ['Select repeated elements', 'Clean, then export', 'Your data stays on your device', 'What Rowlio does not do']) {
      await app.getByTestId('onboarding-next').click();
      await expect(dialog).toContainText(heading);
    }
    await app.getByTestId('onboarding-next').click(); // "Get started"
    await expect(dialog).toHaveCount(0);
    await settingsSaved(app);
    await app.reload();
    await expect(app.getByTestId('topbar')).toBeVisible();
    await expect(app.getByTestId('onboarding')).toHaveCount(0);
  });

  test('without a connected page the workspace explains what to do', async ({ context, extensionId }) => {
    const app = await context.newPage();
    await app.goto(`chrome-extension://${extensionId}/app.html#/tables`);
    await dismissOnboarding(app);
    await expect(app.getByTestId('topbar')).toHaveAttribute('data-status', 'none');
    await expect(app.getByTestId('connection-gate')).toContainText('Connect a page first');
    // Pages that do not need a page still work.
    await app.getByRole('link', { name: 'Projects' }).click();
    await expect(app.getByText('No saved projects yet')).toBeVisible();
    await app.getByRole('link', { name: 'Help & About' }).click();
    await expect(app.getByTestId('about')).toContainText('by Unique Labs');
  });

  test('browser pages are reported as restricted, not as empty', async ({ context, extensionId, serviceWorker }) => {
    const restricted = await context.newPage();
    await restricted.goto('chrome://version/');
    const tabId = await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      // Without access to a tab its URL is hidden: that is the chrome:// tab.
      const hidden = tabs.filter((tab) => !tab.url);
      return hidden[hidden.length - 1]?.id ?? -1;
    });
    expect(tabId).toBeGreaterThan(0);
    const app = await context.newPage();
    await app.goto(`chrome-extension://${extensionId}/app.html?tab=${tabId}#/tables`);
    await dismissOnboarding(app);
    await expect(app.getByTestId('topbar')).toHaveAttribute('data-status', /restricted|no-access/);
    await expect(app.getByTestId('connection-gate')).toBeVisible();
  });

  test('a site Rowlio was not invoked on is not readable (no host permission)', async ({ context, extensionId, serviceWorker }) => {
    const other = await context.newPage();
    const url = SITE.replace('127.0.0.1', '127.0.0.2');
    const reachable = await other
      .goto(`${url}/tables`)
      .then((response) => !!response?.ok())
      .catch(() => false);
    test.skip(!reachable, '127.0.0.2 is not routable in this environment');
    const tabId = await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const hidden = tabs.filter((tab) => !tab.url);
      return hidden[hidden.length - 1]?.id ?? -1;
    });
    const app = await context.newPage();
    await app.goto(`chrome-extension://${extensionId}/app.html?tab=${tabId}#/tables`);
    await dismissOnboarding(app);
    await expect(app.getByTestId('topbar')).toHaveAttribute('data-status', 'no-access');
    await expect(app.getByTestId('connection-gate')).toContainText('No access to this page');
  });

  test('settings persist and theme switches', async ({ connect }) => {
    const { app } = await connect('/tables', '#/settings');
    await app.getByRole('radio', { name: 'Dark' }).click();
    await expect(app.locator('html')).toHaveClass(/dark/);
    await app.getByRole('radio', { name: 'Semicolon' }).click();
    await settingsSaved(app);
    await app.reload();
    await expect(app.locator('html')).toHaveClass(/dark/);
    await expect(app.getByRole('radio', { name: 'Semicolon' })).toHaveAttribute('aria-checked', 'true');
    // The test build declares the fixture hosts; the production build declares none
    // (asserted in manifest.spec.ts), so this list is empty for real users.
    await expect(app.getByText('http://127.0.0.1/*')).toBeVisible();
  });

  test('popup shows the page summary and hands over to the workspace', async ({ context, extensionId, serviceWorker }) => {
    const target = await context.newPage();
    await target.goto(`${SITE}/tables`);
    await target.waitForSelector('#dynamic');
    const tabId = await serviceWorker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id ?? -1, target.url());
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
    await expect(popup.getByTestId('popup')).toHaveAttribute('data-phase', 'ready');
    await expect(popup.getByTestId('popup-host')).toHaveText('127.0.0.1');
    await expect(popup.getByTestId('popup-stats')).toContainText('Tables');
    await expect(popup.getByTestId('popup-extract-tables')).toHaveText(/Extract 6 tables/);

    await popup.getByTestId('popup-extract-tables').click();
    // The workspace tab opened at install time is reused instead of opening another one.
    const isWorkspace = (page: { url(): string }) => page.url().includes('/app.html');
    await expect.poll(() => context.pages().filter(isWorkspace).length).toBe(1);
    const app = context.pages().find(isWorkspace)!;
    await dismissOnboarding(app);
    await expect(app.getByTestId('dataset-tab')).toHaveCount(6, { timeout: 20_000 });
    await expect(app.getByTestId('data-page')).toBeVisible();
  });

  test('the service worker refuses workspace requests from web pages', async ({ connect, serviceWorker }) => {
    const { target } = await connect('/tables');
    // A page script cannot reach the extension at all (no externally_connectable).
    const result = await target.evaluate(() => typeof (globalThis as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime?.sendMessage);
    expect(result).toBe('undefined');
    expect(await serviceWorker.evaluate(() => chrome.runtime.getManifest().externally_connectable)).toBeUndefined();
  });
});
