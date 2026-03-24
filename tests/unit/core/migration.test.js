/**
 * Tests for v1→v2 key binding migration (migrateKeyBindingsV2)
 *
 * The migration runs in background.js but we test the logic in isolation
 * by extracting the same maps and logic from constants.js.
 */

import { installChromeMock, cleanupChromeMock, resetMockStorage, getMockStorage } from '../../helpers/chrome-mock.js';
import { SimpleTestRunner, assert } from '../../helpers/test-utils.js';
import { loadMinimalModules } from '../../helpers/module-loader.js';

await loadMinimalModules();

const runner = new SimpleTestRunner();

// --- Helpers that mirror background.js migration logic ---

const PREDEFINED_CODE_MAP = window.VSC.Constants.PREDEFINED_CODE_MAP;
const KEYCODE_TO_CODE = window.VSC.Constants.KEYCODE_TO_CODE;
const PREDEFINED_ACTIONS = window.VSC.Constants.PREDEFINED_ACTIONS;
const displayKeyFromCode = window.VSC.Constants.displayKeyFromCode;

const DEFAULT_V2_BINDINGS = {
  slower:  { code:'KeyS', key:83, keyCode:83, displayKey:'s', value:0.1, force:false },
  faster:  { code:'KeyD', key:68, keyCode:68, displayKey:'d', value:0.1, force:false },
  rewind:  { code:'KeyZ', key:90, keyCode:90, displayKey:'z', value:10,  force:false },
  advance: { code:'KeyX', key:88, keyCode:88, displayKey:'x', value:10,  force:false },
  reset:   { code:'KeyR', key:82, keyCode:82, displayKey:'r', value:1.0, force:false },
  fast:    { code:'KeyG', key:71, keyCode:71, displayKey:'g', value:1.8, force:false },
  display: { code:'KeyV', key:86, keyCode:86, displayKey:'v', value:0,   force:false },
  mark:    { code:'KeyM', key:77, keyCode:77, displayKey:'m', value:0,   force:false },
  jump:    { code:'KeyJ', key:74, keyCode:74, displayKey:'j', value:0,   force:false },
};

/**
 * Extracted migration logic — mirrors migrateKeyBindingsV2() in background.js
 * Operates on in-memory data instead of chrome.storage for testability.
 */
function migrateBindings(storage) {
  const bindings = storage.keyBindings;

  if (!bindings || !Array.isArray(bindings) || bindings.length === 0) {
    return { skipped: 'no-bindings' };
  }

  if (storage.schemaVersion === 2 && bindings.every(b => b.code !== undefined)) {
    return { skipped: 'already-v2' };
  }

  let predefinedCount = 0, customCount = 0, unmappableCount = 0;

  const migrated = bindings.map(binding => {
    if (binding.code !== undefined) return binding;
    const legacyKey = binding.key;

    if (binding.predefined && PREDEFINED_CODE_MAP[legacyKey]) {
      const mapped = PREDEFINED_CODE_MAP[legacyKey];
      predefinedCount++;
      return { ...binding, code: mapped.code, keyCode: legacyKey, displayKey: mapped.displayKey };
    }

    const code = KEYCODE_TO_CODE[legacyKey];
    if (code) {
      customCount++;
      return { ...binding, code, keyCode: legacyKey, displayKey: displayKeyFromCode(code) };
    }

    unmappableCount++;
    return { ...binding, code: null, keyCode: legacyKey, displayKey: '' };
  });

  const existingActions = new Set(migrated.map(b => b.action));
  for (const action of PREDEFINED_ACTIONS) {
    if (!existingActions.has(action)) {
      migrated.push({ action, ...DEFAULT_V2_BINDINGS[action], predefined: true });
    }
  }

  return {
    keyBindings: migrated,
    schemaVersion: 2,
    stats: { predefinedCount, customCount, unmappableCount },
  };
}

runner.beforeEach(() => {
  installChromeMock();
  resetMockStorage();
});

runner.afterEach(() => {
  cleanupChromeMock();
});

// --- Test cases ---

runner.test('Fresh install (no bindings) should skip migration', () => {
  const result = migrateBindings({ keyBindings: [] });
  assert.equal(result.skipped, 'no-bindings');
});

runner.test('Existing v1 storage with all defaults should migrate all 9 predefined bindings', () => {
  const v1Bindings = [
    { action: 'slower', key: 83, value: 0.1, force: false, predefined: true },
    { action: 'faster', key: 68, value: 0.1, force: false, predefined: true },
    { action: 'rewind', key: 90, value: 10, force: false, predefined: true },
    { action: 'advance', key: 88, value: 10, force: false, predefined: true },
    { action: 'reset', key: 82, value: 1.0, force: false, predefined: true },
    { action: 'fast', key: 71, value: 1.8, force: false, predefined: true },
    { action: 'display', key: 86, value: 0, force: false, predefined: true },
    { action: 'mark', key: 77, value: 0, force: false, predefined: true },
    { action: 'jump', key: 74, value: 0, force: false, predefined: true },
  ];

  const result = migrateBindings({ keyBindings: v1Bindings, schemaVersion: 1 });

  assert.equal(result.schemaVersion, 2);
  assert.equal(result.stats.predefinedCount, 9);
  assert.equal(result.stats.customCount, 0);
  assert.equal(result.stats.unmappableCount, 0);

  // Verify each binding has v2 fields
  for (const b of result.keyBindings) {
    assert.exists(b.code, `Binding for ${b.action} should have code`);
    assert.exists(b.keyCode, `Binding for ${b.action} should have keyCode`);
    assert.exists(b.displayKey, `Binding for ${b.action} should have displayKey`);
    assert.exists(b.key, `Binding for ${b.action} should preserve legacy key field`);
  }

  // Spot check
  const slower = result.keyBindings.find(b => b.action === 'slower');
  assert.equal(slower.code, 'KeyS');
  assert.equal(slower.keyCode, 83);
  assert.equal(slower.key, 83);
  assert.equal(slower.displayKey, 's');
});

runner.test('Custom bindings with standard keyCodes should map correctly', () => {
  const v1Bindings = [
    { action: 'pause', key: 32, value: 0, force: false, predefined: false },   // Space
    { action: 'faster', key: 112, value: 0.5, force: false, predefined: false }, // F1
    { action: 'muted', key: 186, value: 0, force: false, predefined: false },   // Semicolon
  ];

  const result = migrateBindings({ keyBindings: v1Bindings, schemaVersion: 1 });

  assert.equal(result.stats.customCount, 3);

  const pause = result.keyBindings.find(b => b.action === 'pause');
  assert.equal(pause.code, 'Space');
  assert.equal(pause.displayKey, 'Space');

  const faster = result.keyBindings.find(b => b.action === 'faster');
  assert.equal(faster.code, 'F1');

  const muted = result.keyBindings.find(b => b.action === 'muted');
  assert.equal(muted.code, 'Semicolon');
  assert.equal(muted.displayKey, ';');
});

runner.test('Unmappable keyCodes (255, 0) should get code: null', () => {
  const v1Bindings = [
    { action: 'faster', key: 255, value: 0.1, force: false, predefined: false },
    { action: 'slower', key: 0, value: 0.1, force: false, predefined: false },
  ];

  const result = migrateBindings({ keyBindings: v1Bindings, schemaVersion: 1 });

  assert.equal(result.stats.unmappableCount, 2);

  for (const b of result.keyBindings) {
    if (b.action === 'faster' || b.action === 'slower') {
      assert.equal(b.code, null, `Unmappable binding for ${b.action} should have code: null`);
      assert.equal(b.displayKey, '', `Unmappable binding for ${b.action} should have empty displayKey`);
    }
  }
});

runner.test('Partially migrated storage should be idempotent', () => {
  const bindings = [
    // Already migrated
    { action: 'slower', code: 'KeyS', key: 83, keyCode: 83, displayKey: 's', value: 0.1, force: false, predefined: true },
    // Not yet migrated
    { action: 'faster', key: 68, value: 0.1, force: false, predefined: true },
  ];

  const result = migrateBindings({ keyBindings: bindings, schemaVersion: 1 });

  const slower = result.keyBindings.find(b => b.action === 'slower');
  assert.equal(slower.code, 'KeyS', 'Already-migrated binding should be unchanged');
  assert.equal(slower.displayKey, 's');

  const faster = result.keyBindings.find(b => b.action === 'faster');
  assert.equal(faster.code, 'KeyD', 'Un-migrated binding should be migrated');
  assert.equal(faster.keyCode, 68);
});

runner.test('schemaVersion 2 but bindings lack code fields should re-migrate', () => {
  const bindings = [
    { action: 'slower', key: 83, value: 0.1, force: false, predefined: true },
  ];

  // schemaVersion is 2 but bindings don't have code — downgrade recovery
  const result = migrateBindings({ keyBindings: bindings, schemaVersion: 2 });

  assert.equal(result.skipped, undefined, 'Should NOT skip — needs re-migration');
  assert.equal(result.schemaVersion, 2);
  const slower = result.keyBindings.find(b => b.action === 'slower');
  assert.equal(slower.code, 'KeyS');
});

runner.test('schemaVersion 2 with all code fields should skip', () => {
  const bindings = [
    { action: 'slower', code: 'KeyS', key: 83, keyCode: 83, displayKey: 's', value: 0.1, force: false, predefined: true },
  ];

  const result = migrateBindings({ keyBindings: bindings, schemaVersion: 2 });
  assert.equal(result.skipped, 'already-v2');
});

runner.test('v2 storage read by v1 matching logic should still work via key field', () => {
  const v1Bindings = [
    { action: 'slower', key: 83, value: 0.1, force: false, predefined: true },
  ];

  const result = migrateBindings({ keyBindings: v1Bindings, schemaVersion: 1 });
  const slower = result.keyBindings.find(b => b.action === 'slower');

  // v1 code would do: binding.key === event.keyCode
  assert.equal(slower.key, 83, 'Legacy key field must be preserved for downgrade compat');
  assert.equal(slower.key === 83, true, 'v1 matching logic should still work');
});

runner.test('Missing predefined actions should be added by Phase 4', () => {
  // Only 7 of 9 predefined actions present (missing display, jump)
  const v1Bindings = [
    { action: 'slower', key: 83, value: 0.1, force: false, predefined: true },
    { action: 'faster', key: 68, value: 0.1, force: false, predefined: true },
    { action: 'rewind', key: 90, value: 10, force: false, predefined: true },
    { action: 'advance', key: 88, value: 10, force: false, predefined: true },
    { action: 'reset', key: 82, value: 1.0, force: false, predefined: true },
    { action: 'fast', key: 71, value: 1.8, force: false, predefined: true },
    { action: 'mark', key: 77, value: 0, force: false, predefined: true },
  ];

  const result = migrateBindings({ keyBindings: v1Bindings, schemaVersion: 1 });

  const display = result.keyBindings.find(b => b.action === 'display');
  assert.exists(display, 'Missing display action should be added');
  assert.equal(display.code, 'KeyV');
  assert.equal(display.predefined, true);

  const jump = result.keyBindings.find(b => b.action === 'jump');
  assert.exists(jump, 'Missing jump action should be added');
  assert.equal(jump.code, 'KeyJ');
});

runner.test('Migrated bindings should NOT have modifiers object', () => {
  const v1Bindings = [
    { action: 'slower', key: 83, value: 0.1, force: false, predefined: true },
  ];

  const result = migrateBindings({ keyBindings: v1Bindings, schemaVersion: 1 });
  const slower = result.keyBindings.find(b => b.action === 'slower');
  assert.equal(slower.modifiers, undefined, 'Migration should not add modifiers object');
});

runner.test('displayKeyFromCode should produce correct labels', () => {
  assert.equal(displayKeyFromCode('KeyA'), 'a');
  assert.equal(displayKeyFromCode('KeyZ'), 'z');
  assert.equal(displayKeyFromCode('Digit0'), '0');
  assert.equal(displayKeyFromCode('Digit9'), '9');
  assert.equal(displayKeyFromCode('F1'), 'F1');
  assert.equal(displayKeyFromCode('F24'), 'F24');
  assert.equal(displayKeyFromCode('Space'), 'Space');
  assert.equal(displayKeyFromCode('Semicolon'), ';');
  assert.equal(displayKeyFromCode('BracketLeft'), '[');
  assert.equal(displayKeyFromCode('NumpadAdd'), 'Num +');
  assert.equal(displayKeyFromCode(null), '');
  assert.equal(displayKeyFromCode(''), '');
});

export { runner as migrationTestRunner };
