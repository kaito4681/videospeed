/**
 * Unit tests for user-editable controller CSS feature
 * Covers: DEFAULT_CONTROLLER_CSS constant, controllerCSS in settings,
 * www. stripping in applyDomainStyles, dynamic CSS injection, live updates
 */

import { installChromeMock, cleanupChromeMock, resetMockStorage, getMockStorage } from '../../helpers/chrome-mock.js';
import { SimpleTestRunner, assert } from '../../helpers/test-utils.js';
import { loadMinimalModules } from '../../helpers/module-loader.js';

await loadMinimalModules();

const runner = new SimpleTestRunner();

// Helper: ensure chrome mock is active and storage is clean
function setupMock() {
  installChromeMock();
  resetMockStorage();
  window.VSC_settings = null;
}

runner.beforeEach(() => {
  setupMock();
});

runner.afterEach(() => {
  cleanupChromeMock();
});

// --- Phase 1: Foundation ---

runner.test('DEFAULT_CONTROLLER_CSS constant exists and is a non-empty string', () => {
  const css = window.VSC.Constants.DEFAULT_CONTROLLER_CSS;
  assert.exists(css, 'DEFAULT_CONTROLLER_CSS should exist');
  assert.equal(typeof css, 'string', 'DEFAULT_CONTROLLER_CSS should be a string');
  assert.true(css.length > 100, 'DEFAULT_CONTROLLER_CSS should be non-trivial');
});

runner.test('DEFAULT_CONTROLLER_CSS contains site override rules (not base rule)', () => {
  const css = window.VSC.Constants.DEFAULT_CONTROLLER_CSS;
  // Base rule (position:absolute etc) is in inject.css for timing safety — not here
  assert.true(css.includes('vsc-controller'), 'Should contain vsc-controller selectors');
  assert.true(!css.startsWith('vsc-controller {'), 'Should NOT start with base rule (that is in inject.css)');
});

runner.test('DEFAULT_CONTROLLER_CSS contains domain-based rules', () => {
  const css = window.VSC.Constants.DEFAULT_CONTROLLER_CSS;
  assert.true(css.includes('--vsc-domain: "facebook.com"'), 'Should have Facebook rule');
  assert.true(css.includes('--vsc-domain: "netflix.com"'), 'Should have Netflix rule');
  assert.true(css.includes('--vsc-domain: "chatgpt.com"'), 'Should have ChatGPT rule');
  assert.true(css.includes('--vsc-domain: "drive.google.com"'), 'Should have Google Drive rule');
});

runner.test('DEFAULT_CONTROLLER_CSS preserves DOM-contextual YouTube rules', () => {
  const css = window.VSC.Constants.DEFAULT_CONTROLLER_CSS;
  assert.true(css.includes('.ytp-hide-info-bar'), 'Should preserve YouTube info bar selector');
  assert.true(css.includes('.ytp-paid-content-overlay-link'), 'Should preserve paid promotion rule');
  assert.true(css.includes('#player > vsc-controller'), 'Should preserve YouTube embed rule');
});

runner.test('DEFAULT_SETTINGS includes controllerCSS field (sync storage)', () => {
  const defaults = window.VSC.Constants.DEFAULT_SETTINGS;
  assert.exists(defaults.controllerCSS, 'DEFAULT_SETTINGS should have controllerCSS');
  assert.equal(
    defaults.controllerCSS,
    window.VSC.Constants.DEFAULT_CONTROLLER_CSS,
    'controllerCSS should reference DEFAULT_CONTROLLER_CSS'
  );
});

runner.test('controllerCSS loads from storage into settings', async () => {
  setupMock();
  const customCSS = 'vsc-controller { top: 999px; }';
  getMockStorage().controllerCSS = customCSS;

  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  assert.equal(
    config.settings.controllerCSS,
    customCSS,
    'Should load custom controllerCSS from storage'
  );
});

runner.test('controllerCSS falls back to default when absent from storage', async () => {
  setupMock();

  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  assert.equal(
    config.settings.controllerCSS,
    window.VSC.Constants.DEFAULT_CONTROLLER_CSS,
    'Should fall back to DEFAULT_CONTROLLER_CSS when not in storage'
  );
});

runner.test('controllerCSS round-trips through save and load', async () => {
  setupMock();

  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  const customCSS = 'vsc-controller { position: relative; top: 42px; }';
  await config.save({ controllerCSS: customCSS });

  // Create a fresh config and load from storage
  const config2 = new window.VSC.VideoSpeedConfig();
  await config2.load();

  assert.equal(
    config2.settings.controllerCSS,
    customCSS,
    'Custom CSS should persist through save/load cycle'
  );
});

export { runner as controllerCSSTestRunner };
