/**
 * Tests for options page shortcut recording and saving (v2 schema).
 *
 * Tests recordKeyPress, createKeyBindings, and the BLACKLISTED_CODES check.
 * These functions are defined in options.js but we test their logic here
 * using extracted/replicated helpers.
 */

import { installChromeMock, cleanupChromeMock, resetMockStorage } from '../../helpers/chrome-mock.js';
import { SimpleTestRunner, assert } from '../../helpers/test-utils.js';
import { loadMinimalModules } from '../../helpers/module-loader.js';

await loadMinimalModules();

const runner = new SimpleTestRunner();

runner.beforeEach(() => {
  installChromeMock();
  resetMockStorage();
});

runner.afterEach(() => {
  cleanupChromeMock();
});

// --- Replicate minimal recording logic from options.js for testing ---

function recordKeyPress(e) {
  const BLACKLISTED_CODES = window.VSC.Constants.BLACKLISTED_CODES;

  if (e.code === 'Backspace') {
    e.target.value = '';
    e.target.code = null;
    e.target.keyCode = null;
    e.target.displayKey = null;
    e.target.modifiers = undefined;
    return 'backspace';
  } else if (e.code === 'Escape') {
    e.target.value = 'null';
    e.target.code = null;
    e.target.keyCode = null;
    e.target.displayKey = null;
    e.target.modifiers = undefined;
    return 'escape';
  }

  if (BLACKLISTED_CODES.has(e.code)) {
    return 'blocked';
  }

  e.target.code = e.code;
  e.target.keyCode = e.keyCode;
  e.target.displayKey = e.key;

  const hasMod = e.ctrlKey || e.altKey || e.shiftKey || e.metaKey;
  e.target.modifiers = hasMod ? {
    ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey,
  } : undefined;

  return 'accepted';
}

function createKeyBindings(input, action, value, force, predefined) {
  return {
    action,
    code: input.code,
    key: input.keyCode,
    keyCode: input.keyCode,
    displayKey: input.displayKey,
    value,
    force,
    predefined,
    ...(input.modifiers ? { modifiers: input.modifiers } : {}),
  };
}

function makeInput() {
  return { value: '', code: undefined, keyCode: undefined, displayKey: undefined, modifiers: undefined };
}

function makeKeyEvent(code, key, keyCode, mods = {}) {
  return {
    code, key, keyCode,
    ctrlKey: mods.ctrl || false,
    altKey: mods.alt || false,
    shiftKey: mods.shift || false,
    metaKey: mods.meta || false,
    target: makeInput(),
  };
}

// --- Tests ---

runner.test('recordKeyPress captures code, key, keyCode on input element', () => {
  const e = makeKeyEvent('KeyS', 's', 83);
  const result = recordKeyPress(e);

  assert.equal(result, 'accepted');
  assert.equal(e.target.code, 'KeyS');
  assert.equal(e.target.keyCode, 83);
  assert.equal(e.target.displayKey, 's');
});

runner.test('createKeyBindings emits v2 schema with legacy key field', () => {
  const input = { code: 'KeyD', keyCode: 68, displayKey: 'd', modifiers: undefined };
  const binding = createKeyBindings(input, 'faster', 0.1, false, true);

  assert.equal(binding.code, 'KeyD');
  assert.equal(binding.key, 68, 'Legacy key field must be present for downgrade');
  assert.equal(binding.keyCode, 68);
  assert.equal(binding.displayKey, 'd');
  assert.equal(binding.predefined, true);
  assert.equal(binding.modifiers, undefined, 'No modifiers should not produce modifiers object');
});

runner.test('BLACKLISTED_CODES: Tab is blocked', () => {
  const e = makeKeyEvent('Tab', 'Tab', 9);
  const result = recordKeyPress(e);
  assert.equal(result, 'blocked');
});

runner.test('BLACKLISTED_CODES: ContextMenu is blocked (regression for keyCode 93)', () => {
  const e = makeKeyEvent('ContextMenu', 'ContextMenu', 93);
  const result = recordKeyPress(e);
  assert.equal(result, 'blocked');
});

runner.test('BLACKLISTED_CODES: ShiftLeft is blocked', () => {
  const e = makeKeyEvent('ShiftLeft', 'Shift', 16);
  const result = recordKeyPress(e);
  assert.equal(result, 'blocked');
});

runner.test('BLACKLISTED_CODES: CapsLock is blocked (new in v2)', () => {
  const e = makeKeyEvent('CapsLock', 'CapsLock', 20);
  const result = recordKeyPress(e);
  assert.equal(result, 'blocked');
});

runner.test('Backspace clears input via event.code', () => {
  const e = makeKeyEvent('Backspace', 'Backspace', 8);
  e.target.code = 'KeyS';
  e.target.keyCode = 83;
  e.target.displayKey = 's';

  const result = recordKeyPress(e);

  assert.equal(result, 'backspace');
  assert.equal(e.target.value, '');
  assert.equal(e.target.code, null, 'code should be cleared');
  assert.equal(e.target.keyCode, null, 'keyCode should be cleared');
});

runner.test('Escape sets null via event.code', () => {
  const e = makeKeyEvent('Escape', 'Escape', 27);
  const result = recordKeyPress(e);

  assert.equal(result, 'escape');
  assert.equal(e.target.value, 'null');
  assert.equal(e.target.code, null);
  assert.equal(e.target.keyCode, null);
});

runner.test('Modifier recording: Ctrl+S captures modifiers object', () => {
  const e = makeKeyEvent('KeyS', 's', 83, { ctrl: true });
  const result = recordKeyPress(e);

  assert.equal(result, 'accepted');
  assert.exists(e.target.modifiers, 'Modifiers should be captured');
  assert.true(e.target.modifiers.ctrl);
  assert.false(e.target.modifiers.alt);
  assert.false(e.target.modifiers.shift);
  assert.false(e.target.modifiers.meta);
});

runner.test('Modifiers omitted when all false', () => {
  const e = makeKeyEvent('KeyS', 's', 83);
  const result = recordKeyPress(e);

  assert.equal(result, 'accepted');
  assert.equal(e.target.modifiers, undefined, 'No modifiers should produce undefined');
});

runner.test('createKeyBindings includes modifiers when present', () => {
  const input = {
    code: 'KeyS', keyCode: 83, displayKey: 's',
    modifiers: { ctrl: true, alt: false, shift: false, meta: false },
  };
  const binding = createKeyBindings(input, 'save-chord', 0, false, false);

  assert.exists(binding.modifiers);
  assert.true(binding.modifiers.ctrl);
});

runner.test('createKeyBindings omits modifiers when undefined', () => {
  const input = { code: 'KeyS', keyCode: 83, displayKey: 's', modifiers: undefined };
  const binding = createKeyBindings(input, 'slower', 0.1, false, true);

  assert.equal(binding.modifiers, undefined, 'No modifiers key in binding');
  // Verify modifiers is not even in the object
  assert.false('modifiers' in binding, 'modifiers key should not exist in binding');
});

export { runner as optionsRecordingTestRunner };
