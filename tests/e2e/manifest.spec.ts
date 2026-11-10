// The PRODUCTION build (dist/) is what ships. These checks read it directly so the
// privacy / permission promises are enforced by the test suite, not just documented.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const dist = path.resolve(import.meta.dirname, '..', '..', 'dist');
const read = (file: string) => fs.readFileSync(path.join(dist, file), 'utf8');

test.describe('production build', () => {
  test.skip(!fs.existsSync(path.join(dist, 'manifest.json')), 'run `npm run build` first');

  test('manifest requests only activeTab and scripting', () => {
    const manifest = JSON.parse(read('manifest.json'));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions.sort()).toEqual(['activeTab', 'scripting']);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.content_scripts).toBeUndefined(); // injected on demand only
    expect(manifest.externally_connectable).toBeUndefined();
    expect(manifest.web_accessible_resources).toBeUndefined();
    expect(manifest.optional_host_permissions).toEqual(['http://*/*', 'https://*/*']);
    expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(manifest.action.default_popup).toBe('popup.html');
    for (const size of ['16', '32', '48', '128']) {
      expect(fs.existsSync(path.join(dist, manifest.icons[size])), `icon ${size}`).toBe(true);
    }
  });

  test('content security policy blocks every remote connection and remote code', () => {
    const csp: string = JSON.parse(read('manifest.json')).content_security_policy.extension_pages;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/https?:|unsafe-eval|\*/);
  });

  test('store name and description fit Chrome Web Store limits', () => {
    const messages = JSON.parse(read('_locales/en/messages.json'));
    expect(messages.extName.message).toBe('Rowlio: Free Web Scraper & Data Extractor');
    expect(messages.extName.message.length).toBeLessThanOrEqual(75);
    expect(messages.extDescription.message.length).toBeLessThanOrEqual(132);
  });

  test('shipped code contains no network calls, eval or remote URLs', () => {
    const files = ['background.js', 'content.js', ...fs.readdirSync(path.join(dist, 'assets')).filter((name) => name.endsWith('.js')).map((name) => `assets/${name}`)];
    for (const file of files) {
      const code = read(file);
      expect(code, `${file}: fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(code, `${file}: XMLHttpRequest`).not.toMatch(/XMLHttpRequest/);
      expect(code, `${file}: WebSocket`).not.toMatch(/new\s+WebSocket/);
      expect(code, `${file}: sendBeacon`).not.toMatch(/sendBeacon/);
      expect(code, `${file}: eval`).not.toMatch(/\beval\s*\(/);
      expect(code, `${file}: new Function`).not.toMatch(/new\s+Function\s*\(/);
      expect(code, `${file}: importScripts`).not.toMatch(/importScripts\s*\(/);
    }
    // The content script is a single classic script without imports.
    expect(read('content.js')).not.toMatch(/^\s*import\s/m);
    // The E2E-only switches must not be enabled in production.
    expect(read('content.js')).toMatch(/attachShadow\(\{mode:[`'"]closed[`'"]\}\)/);
  });
});
