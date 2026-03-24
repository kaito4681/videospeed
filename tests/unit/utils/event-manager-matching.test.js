/**
 * Tests for event.code-based keyboard matching algorithm in EventManager.
 * Covers: chord match, simple match, legacy fallback, IME guard, dedup, precedence.
 */

import { installChromeMock, cleanupChromeMock, resetMockStorage } from '../../helpers/chrome-mock.js';
import { SimpleTestRunner, assert, createMockVideo, createMockDOM } from '../../helpers/test-utils.js';
import { loadCoreModules } from '../../helpers/module-loader.js';

await loadCoreModules();

const runner = new SimpleTestRunner();
let mockDOM;

// Helper: create a minimal environment with the EventManager wired to a mock action
function setupEnv(keyBindings) {
  const config = window.VSC.videoSpeedConfig;
  config._loaded = true;
  config.settings.keyBindings = keyBindings;

  const actions = [];
  const actionHandler = {
    runAction: (action, value, event) => actions.push({ action, value }),
  };

  const eventManager = new window.VSC.EventManager(config, actionHandler);

  // Register a mock video so media-elements check passes
  const video = createMockVideo({ playbackRate: 1.0 });
  if (!video.parentElement) {
    mockDOM.container.appendChild(video);
  }
  video.vsc = { div: document.createElement('div'), speedIndicator: { textContent: '1.00' } };
  window.VSC.stateManager.controllers.set('test-video', {
    id: 'test-video', element: video, videoSrc: 'test', tagName: 'VIDEO',
    created: Date.now(), isActive: true,
  });

  return { config, eventManager, actions, video };
}

function makeEvent(overrides = {}) {
  return {
    code: overrides.code || '',
    key: overrides.key || '',
    keyCode: overrides.keyCode || 0,
    ctrlKey: overrides.ctrlKey || false,
    altKey: overrides.altKey || false,
    shiftKey: overrides.shiftKey || false,
    metaKey: overrides.metaKey || false,
    isComposing: overrides.isComposing || false,
    timeStamp: overrides.timeStamp || Date.now(),
    type: overrides.type || 'keydown',
    target: overrides.target || document.body,
    preventDefault: () => {},
    stopPropagation: () => {},
  };
}

runner.beforeEach(() => {
  installChromeMock();
  resetMockStorage();
  mockDOM = createMockDOM();
  if (window.VSC && window.VSC.stateManager) {
    window.VSC.stateManager.controllers.clear();
  }
});

runner.afterEach(() => {
  cleanupChromeMock();
  if (mockDOM) mockDOM.cleanup();
});

// --- Chord matching ---

runner.test('Chord: Ctrl+KeyS matches chord binding, not simple binding', () => {
  const { eventManager, actions } = setupEnv([
    { action: 'slower', code: 'KeyS', key: 83, keyCode: 83, value: 0.1, force: false },
    { action: 'save-chord', code: 'KeyS', key: 83, keyCode: 83, value: 0, force: false,
      modifiers: { ctrl: true, alt: false, shift: false, meta: false } },
  ]);

  eventManager.handleKeydown(makeEvent({
    code: 'KeyS', key: 's', keyCode: 83, ctrlKey: true, timeStamp: 100,
  }));

  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, 'save-chord', 'Chord binding should take precedence');
});

// --- Simple matching ---

runner.test('Simple: KeyS matches simple binding when no modifiers active', () => {
  const { eventManager, actions } = setupEnv([
    { action: 'slower', code: 'KeyS', key: 83, keyCode: 83, displayKey: 's', value: 0.1, force: false },
  ]);

  eventManager.handleKeydown(makeEvent({
    code: 'KeyS', key: 's', keyCode: 83, timeStamp: 200,
  }));

  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, 'slower');
});

runner.test('Simple: Shift+KeyS still matches simple KeyS binding (backward compat)', () => {
  const { eventManager, actions } = setupEnv([
    { action: 'slower', code: 'KeyS', key: 83, keyCode: 83, displayKey: 's', value: 0.1, force: false },
  ]);

  eventManager.handleKeydown(makeEvent({
    code: 'KeyS', key: 'S', keyCode: 83, shiftKey: true, timeStamp: 300,
  }));

  assert.equal(actions.length, 1, 'Shift should not block simple match');
  assert.equal(actions[0].action, 'slower');
});

runner.test('Simple: Ctrl+KeyS does NOT match simple binding', () => {
  const { eventManager, actions } = setupEnv([
    { action: 'slower', code: 'KeyS', key: 83, keyCode: 83, displayKey: 's', value: 0.1, force: false },
  ]);

  eventManager.handleKeydown(makeEvent({
    code: 'KeyS', key: 's', keyCode: 83, ctrlKey: true, timeStamp: 400,
  }));

  assert.equal(actions.length, 0, 'Ctrl modifier should prevent simple match');
});

// --- Legacy fallback ---

runner.test('Legacy: binding with code:null matches on keyCode', () => {
  const { eventManager, actions } = setupEnv([
    { action: 'custom', code: null, key: 255, keyCode: 255, displayKey: '', value: 0.1, force: false },
  ]);

  // Event with valid code that doesn't match, so falls through to legacy
  eventManager.handleKeydown(makeEvent({
    code: 'Unidentified', key: '', keyCode: 255, timeStamp: 500,
  }));

  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, 'custom');
});

runner.test('Legacy: Ctrl+keyCode does NOT match legacy binding (modifier gating)', () => {
  const { eventManager, actions } = setupEnv([
    { action: 'slower', code: null, key: 83, keyCode: 83, value: 0.1, force: false },
  ]);

  eventManager.handleKeydown(makeEvent({
    code: '', key: 's', keyCode: 83, ctrlKey: true, timeStamp: 600,
  }));

  assert.equal(actions.length, 0, 'Ctrl should prevent legacy match');
});

// --- Empty event.code runtime fallback ---

runner.test('Empty event.code: falls back to keyCode matching for all bindings', () => {
  const { eventManager, actions } = setupEnv([
    { action: 'slower', code: 'KeyS', key: 83, keyCode: 83, displayKey: 's', value: 0.1, force: false },
  ]);

  // Virtual keyboard or remote desktop — event.code is empty
  eventManager.handleKeydown(makeEvent({
    code: '', key: 's', keyCode: 83, timeStamp: 700,
  }));

  assert.equal(actions.length, 1, 'Should match via keyCode fallback when code is empty');
  assert.equal(actions[0].action, 'slower');
});

// --- IME guards ---

runner.test('IME: isComposing=true should block all matching', () => {
  const { eventManager, actions } = setupEnv([
    { action: 'slower', code: 'KeyS', key: 83, keyCode: 83, value: 0.1, force: false },
  ]);

  eventManager.handleKeydown(makeEvent({
    code: 'KeyS', key: 's', keyCode: 83, isComposing: true, timeStamp: 800,
  }));

  assert.equal(actions.length, 0, 'isComposing should block');
});

runner.test('IME: keyCode 229 should block all matching', () => {
  const { eventManager, actions } = setupEnv([
    { action: 'slower', code: 'KeyS', key: 83, keyCode: 83, value: 0.1, force: false },
  ]);

  eventManager.handleKeydown(makeEvent({
    code: '', key: '', keyCode: 229, timeStamp: 900,
  }));

  assert.equal(actions.length, 0, 'keyCode 229 (IME sentinel) should block');
});

runner.test('IME: key="Process" should block all matching', () => {
  const { eventManager, actions } = setupEnv([
    { action: 'slower', code: 'KeyS', key: 83, keyCode: 83, value: 0.1, force: false },
  ]);

  eventManager.handleKeydown(makeEvent({
    code: '', key: 'Process', keyCode: 0, timeStamp: 1000,
  }));

  assert.equal(actions.length, 0, 'key="Process" should block');
});

// --- Event deduplication ---

runner.test('Event dedup: same code+key+timeStamp+type should be deduplicated', () => {
  const { eventManager, actions } = setupEnv([
    { action: 'slower', code: 'KeyS', key: 83, keyCode: 83, displayKey: 's', value: 0.1, force: false },
  ]);

  const event = makeEvent({ code: 'KeyS', key: 's', keyCode: 83, timeStamp: 1100 });
  eventManager.handleKeydown(event);
  eventManager.handleKeydown(event); // duplicate

  assert.equal(actions.length, 1, 'Duplicate event should be ignored');
});

// --- Chord precedence ---

runner.test('Chord precedence: Ctrl+S chord fires instead of plain S binding', () => {
  const { eventManager, actions } = setupEnv([
    { action: 'slower', code: 'KeyS', key: 83, keyCode: 83, displayKey: 's', value: 0.1, force: false },
    { action: 'ctrl-s-action', code: 'KeyS', key: 83, keyCode: 83, value: 0, force: true,
      modifiers: { ctrl: true, alt: false, shift: false, meta: false } },
  ]);

  // Plain S → slower
  eventManager.handleKeydown(makeEvent({
    code: 'KeyS', key: 's', keyCode: 83, timeStamp: 1200,
  }));
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, 'slower');

  // Ctrl+S → chord action
  eventManager.handleKeydown(makeEvent({
    code: 'KeyS', key: 's', keyCode: 83, ctrlKey: true, timeStamp: 1300,
  }));
  assert.equal(actions.length, 2);
  assert.equal(actions[1].action, 'ctrl-s-action');
});

export { runner as eventManagerMatchingTestRunner };
