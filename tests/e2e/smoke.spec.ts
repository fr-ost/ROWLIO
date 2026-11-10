import { test, expect } from './fixtures';

test('extension loads and connects to a page', async ({ connect, extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
  const { app } = await connect('/tables', '#/tables');
  await expect(app.getByTestId('table-card').first()).toBeVisible();
  await app.screenshot({ path: 'test-results/smoke-tables.png' });
});
