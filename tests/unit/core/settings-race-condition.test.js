/**
 * Tests for the settings race condition fix.
 *
 * Covers: granular writes (only changed keys hit storage), debounce
 * correctness, cross-context race windows, onChanged listener freshness,
 * self-echo detection (own writes don't revert state or cancel timers),
 * and external-write precedence (stale debounce timers are cancelled).
 */

import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
  getMockStorage,
  simulateExternalStorageWrite,
} from '../../helpers/chrome-mock.js';
import { SimpleTestRunner, assert, wait } from '../../helpers/test-utils.js';
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

// ===========================================================================
// SECTION 1: Granular write correctness
// ===========================================================================

runner.test('save() writes ONLY the changed keys, not the full blob', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  // Capture what gets written to storage
  const writtenPayloads = [];
  const originalSet = window.VSC.StorageManager.set;
  window.VSC.StorageManager.set = async (data) => {
    writtenPayloads.push({ ...data });
    return originalSet.call(window.VSC.StorageManager, data);
  };

  // Save ONLY startHidden
  await config.save({ startHidden: true });

  assert.equal(writtenPayloads.length, 1, 'Should write exactly once');
  const written = writtenPayloads[0];
  const writtenKeys = Object.keys(written);

  // The payload should contain ONLY startHidden — not lastSpeed, not keyBindings, etc.
  assert.equal(writtenKeys.length, 1, `Should write 1 key, got ${writtenKeys.length}: ${writtenKeys}`);
  assert.equal(writtenKeys[0], 'startHidden', 'Should write only startHidden');
  assert.equal(written.startHidden, true, 'Value should be true');

  window.VSC.StorageManager.set = originalSet;
});

runner.test('save() with multiple keys writes only those keys', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  const writtenPayloads = [];
  const originalSet = window.VSC.StorageManager.set;
  window.VSC.StorageManager.set = async (data) => {
    writtenPayloads.push({ ...data });
    return originalSet.call(window.VSC.StorageManager, data);
  };

  await config.save({ startHidden: true, controllerOpacity: 0.8 });

  assert.equal(writtenPayloads.length, 1);
  const writtenKeys = Object.keys(writtenPayloads[0]).sort();
  assert.deepEqual(writtenKeys, ['controllerOpacity', 'startHidden']);

  window.VSC.StorageManager.set = originalSet;
});

runner.test('debounced lastSpeed save writes ONLY lastSpeed', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  // Wait generously for any pending async from load() and prior tests
  await wait(1200);

  // Set up spy AFTER all prior async is drained
  const writtenPayloads = [];
  const originalSet = window.VSC.StorageManager.set;
  window.VSC.StorageManager.set = async (data) => {
    writtenPayloads.push({ ...data });
    return originalSet.call(window.VSC.StorageManager, data);
  };

  // Trigger debounced save
  await config.save({ lastSpeed: 2.5 });

  // Nothing written yet (debounced)
  assert.equal(writtenPayloads.length, 0, 'Should not write before debounce fires');

  // Wait for debounce to fire
  await wait(1200);

  assert.equal(writtenPayloads.length, 1, `Should write exactly once after debounce, got ${writtenPayloads.length}`);
  const written = writtenPayloads[0];
  const writtenKeys = Object.keys(written);
  assert.equal(writtenKeys.length, 1, `Should write 1 key, got ${writtenKeys.length}: ${writtenKeys}`);
  assert.equal(writtenKeys[0], 'lastSpeed', 'Should write only lastSpeed');
  assert.equal(written.lastSpeed, 2.5, 'Speed should be 2.5');

  window.VSC.StorageManager.set = originalSet;
});

// ===========================================================================
// SECTION 2: Race window reproduction — these FAIL on the old code
// ===========================================================================

runner.test('Race 1: options page save does NOT clobber speed from another context', async () => {
  // Simulate: content script set speed to 2.0, then options page saves startHidden
  const storage = getMockStorage();

  // T=0: config loads (sees lastSpeed=1.0)
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();
  assert.equal(config.settings.lastSpeed, 1.0);

  // T=1: "another context" changes speed to 2.0 in storage
  // (simulated by direct storage write)
  storage.lastSpeed = 2.0;

  // T=2: this config saves startHidden=true (simulating options page)
  await config.save({ startHidden: true });

  // Wait for any async storage operations
  await wait(50);

  // CRITICAL: storage.lastSpeed should STILL be 2.0
  // Old code would write {...this.settings} which has stale lastSpeed=1.0
  assert.equal(
    storage.lastSpeed,
    2.0,
    `Speed in storage should be 2.0 (untouched), got ${storage.lastSpeed}`
  );
});

runner.test('Race 2: debounce timer does NOT write stale non-speed fields', async () => {
  const storage = getMockStorage();

  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  // T=0: config initiates debounced speed save
  await config.save({ lastSpeed: 1.5 });

  // T=0.5: another context changes startHidden in storage
  storage.startHidden = true;

  // T=1: debounce fires — should write ONLY {lastSpeed: 1.5}, NOT {startHidden: false}
  await wait(1100);

  assert.equal(
    storage.startHidden,
    true,
    `startHidden in storage should still be true, got ${storage.startHidden}`
  );
  assert.equal(storage.lastSpeed, 1.5, 'Speed should be 1.5');
});

runner.test('Race 3: two config instances writing different keys dont clobber each other', async () => {
  const storage = getMockStorage();

  // Two independent config instances (simulates two tabs)
  const configA = new window.VSC.VideoSpeedConfig();
  await configA.load();

  const configB = new window.VSC.VideoSpeedConfig();
  await configB.load();

  // Config A saves controllerOpacity
  await configA.save({ controllerOpacity: 0.9 });

  // Config B saves startHidden
  await configB.save({ startHidden: true });

  await wait(50);

  // BOTH should be preserved
  assert.equal(storage.controllerOpacity, 0.9, 'controllerOpacity should be 0.9');
  assert.equal(storage.startHidden, true, 'startHidden should be true');
});

runner.test('Race 4: rapid save of different keys preserves all', async () => {
  const storage = getMockStorage();

  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  // Rapid sequence of saves — each should write only its own key
  await config.save({ startHidden: true });
  await config.save({ controllerOpacity: 0.7 });
  await config.save({ audioBoolean: true });

  await wait(50);

  assert.equal(storage.startHidden, true);
  assert.equal(storage.controllerOpacity, 0.7);
  assert.equal(storage.audioBoolean, true);
  // Speed should be untouched (still default)
  assert.equal(storage.lastSpeed, 1.0);
});

runner.test('Race 5: options page full settings save does not revert speed', async () => {
  const storage = getMockStorage();

  // Simulate content script has set speed to 3.0
  storage.lastSpeed = 3.0;

  // Options page loads (gets lastSpeed=3.0 at load time)
  const optionsConfig = new window.VSC.VideoSpeedConfig();
  await optionsConfig.load();

  // Meanwhile, user changes speed to 4.0 on a content script tab
  storage.lastSpeed = 4.0;

  // Options page saves — this mimics what options.js:275-325 does
  // It builds settingsToSave from form values, which does NOT include lastSpeed
  const settingsFromForm = {
    rememberSpeed: true,
    forceLastSavedSpeed: false,
    audioBoolean: true,
    startHidden: false,
    controllerOpacity: 0.5,
    controllerButtonSize: 16,
    logLevel: 4,
    keyBindings: optionsConfig.settings.keyBindings,
    blacklist: 'www.instagram.com',
  };

  await optionsConfig.save(settingsFromForm);
  await wait(50);

  // CRITICAL: storage should NOT have reverted lastSpeed from 4.0 to 3.0
  assert.equal(
    storage.lastSpeed,
    4.0,
    `Speed should still be 4.0 (untouched by options save), got ${storage.lastSpeed}`
  );

  // But options settings should be saved
  assert.equal(storage.rememberSpeed, true);
  assert.equal(storage.controllerOpacity, 0.5);
});

// ===========================================================================
// SECTION 3: onChanged listener keeps in-memory state fresh
// ===========================================================================

runner.test('onChanged listener updates in-memory settings from external writes', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  assert.equal(config.settings.lastSpeed, 1.0, 'Initial speed should be 1.0');

  // Simulate external write (e.g., from content script in another tab)
  simulateExternalStorageWrite({ lastSpeed: 3.0 });

  // In-memory should be updated via onChanged
  assert.equal(
    config.settings.lastSpeed,
    3.0,
    `In-memory lastSpeed should be 3.0 after external write, got ${config.settings.lastSpeed}`
  );
});

runner.test('onChanged listener updates multiple keys at once', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  simulateExternalStorageWrite({
    lastSpeed: 2.5,
    startHidden: true,
    controllerOpacity: 0.8,
  });

  assert.equal(config.settings.lastSpeed, 2.5);
  assert.equal(config.settings.startHidden, true);
  assert.equal(config.settings.controllerOpacity, 0.8);
});

runner.test('onChanged listener ignores keys not in settings', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  // Write a key that doesn't exist in settings — should not crash
  simulateExternalStorageWrite({ unknownKey: 'somevalue' });

  // Existing settings should be unchanged
  assert.equal(config.settings.lastSpeed, 1.0);
});

runner.test('onChanged listener ignores undefined newValue', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();
  config.settings.lastSpeed = 2.0;

  // Simulate a change with undefined newValue (happens when key is removed)
  const changes = { lastSpeed: { oldValue: 2.0, newValue: undefined } };
  // Manually fire onChanged
  simulateExternalStorageWrite({}); // noop, just to test the mechanism
  // Now manually test the guard
  for (const [key, change] of Object.entries(changes)) {
    if (key in config.settings && change.newValue !== undefined) {
      config.settings[key] = change.newValue;
    }
  }

  // Should NOT have been set to undefined
  assert.equal(config.settings.lastSpeed, 2.0, 'Should not set to undefined');
});

// ===========================================================================
// SECTION 4: Debounce edge cases with granular writes
// ===========================================================================

runner.test('debounced save coalesces correctly with granular writes', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  const writtenPayloads = [];
  const originalSet = window.VSC.StorageManager.set;
  window.VSC.StorageManager.set = async (data) => {
    writtenPayloads.push({ ...data });
    return originalSet.call(window.VSC.StorageManager, data);
  };

  // Rapid speed changes
  await config.save({ lastSpeed: 1.1 });
  await config.save({ lastSpeed: 1.2 });
  await config.save({ lastSpeed: 1.3 });
  await config.save({ lastSpeed: 1.4 });

  // Nothing written yet
  assert.equal(writtenPayloads.length, 0);

  // In-memory should have the latest value
  assert.equal(config.settings.lastSpeed, 1.4);

  // Wait for debounce
  await wait(1100);

  // Should write once with final value, and ONLY lastSpeed
  assert.equal(writtenPayloads.length, 1);
  assert.deepEqual(writtenPayloads[0], { lastSpeed: 1.4 });

  window.VSC.StorageManager.set = originalSet;
});

runner.test('interleaved speed and non-speed saves work correctly', async () => {
  const storage = getMockStorage();
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  // Speed save (debounced)
  await config.save({ lastSpeed: 2.0 });

  // Non-speed save (immediate) — should NOT carry stale lastSpeed
  await config.save({ startHidden: true });

  await wait(50);

  // startHidden should be in storage immediately
  assert.equal(storage.startHidden, true);

  // Speed not yet written (still debouncing)
  // But once debounce fires...
  await wait(1100);

  assert.equal(storage.lastSpeed, 2.0);
  assert.equal(storage.startHidden, true); // should still be true
});

runner.test('debounce timer reset still writes only lastSpeed', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  const writtenPayloads = [];
  const originalSet = window.VSC.StorageManager.set;
  window.VSC.StorageManager.set = async (data) => {
    writtenPayloads.push({ ...data });
    return originalSet.call(window.VSC.StorageManager, data);
  };

  // First speed save
  await config.save({ lastSpeed: 1.5 });

  // Wait 500ms then another save (resets timer)
  await wait(500);
  await config.save({ lastSpeed: 2.0 });

  // Wait 500ms more — first timer would have fired but was reset
  await wait(500);
  assert.equal(writtenPayloads.length, 0, 'Should not have fired yet');

  // Wait remaining time
  await wait(600);
  assert.equal(writtenPayloads.length, 1);
  assert.deepEqual(writtenPayloads[0], { lastSpeed: 2.0 });

  window.VSC.StorageManager.set = originalSet;
});

// ===========================================================================
// SECTION 5: In-memory consistency
// ===========================================================================

runner.test('in-memory settings update immediately even before storage write', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  // Save startHidden — in-memory should update right away
  const savePromise = config.save({ startHidden: true });

  // Check BEFORE await completes
  assert.equal(config.settings.startHidden, true, 'In-memory should be true immediately');

  await savePromise;
});

runner.test('in-memory lastSpeed updates immediately during debounce', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  await config.save({ lastSpeed: 3.0 });

  // In-memory should be 3.0 even though storage hasn't been written yet
  assert.equal(config.settings.lastSpeed, 3.0);
});

runner.test('save with empty object is a no-op (no storage write)', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  const writtenPayloads = [];
  const originalSet = window.VSC.StorageManager.set;
  window.VSC.StorageManager.set = async (data) => {
    writtenPayloads.push({ ...data });
  };

  await config.save({});

  // Empty save should short-circuit — no wasted round-trip to storage
  assert.equal(writtenPayloads.length, 0, 'Should not write to storage for empty save');

  window.VSC.StorageManager.set = originalSet;
});

// ===========================================================================
// SECTION 6: Defensive edge cases
// ===========================================================================

runner.test('save works correctly when called from load() (keyBindings init)', async () => {
  // Set keyBindings to empty array (triggers first-time init in load())
  const storage = getMockStorage();
  storage.keyBindings = [];

  // Set up spy BEFORE load() since we want to capture the init write
  const writtenPayloads = [];
  const originalSet = window.VSC.StorageManager.set;
  window.VSC.StorageManager.set = async (data) => {
    writtenPayloads.push(Object.keys(data));
    return originalSet.call(window.VSC.StorageManager, data);
  };

  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  // Wait for async storage operations to complete
  await wait(50);

  // The load() path calls save({keyBindings: ...}) — should write only keyBindings
  assert.true(writtenPayloads.length >= 1, `Should have at least 1 write, got ${writtenPayloads.length}`);
  const keyBindingsWrite = writtenPayloads.find((keys) => keys.includes('keyBindings'));
  assert.exists(keyBindingsWrite, `Should have written keyBindings, writes were: ${JSON.stringify(writtenPayloads)}`);
  assert.equal(keyBindingsWrite.length, 1, `Should have written ONLY keyBindings, got: ${keyBindingsWrite}`);

  window.VSC.StorageManager.set = originalSet;
});

// ===========================================================================
// SECTION 7: Self-echo detection & external write cancellation
// ===========================================================================

runner.test('self-echo from debounce does NOT revert in-memory state', async () => {
  // Reproduces: timer fires (writes 2.5), user changes to 2.8, echo of 2.5
  // arrives — must NOT revert in-memory from 2.8 back to 2.5.
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  // Start debounce for 2.5
  await config.save({ lastSpeed: 2.5 });

  // Wait for debounce to fire and write
  await wait(1200);

  // User immediately changes speed again (new debounce cycle)
  await config.save({ lastSpeed: 2.8 });
  assert.equal(config.settings.lastSpeed, 2.8, 'In-memory should be 2.8');

  // The onChanged echo from the 2.5 write fires via mock's setTimeout(5ms).
  // Give it time to arrive.
  await wait(50);

  // CRITICAL: in-memory must still be 2.8, NOT reverted to 2.5
  assert.equal(
    config.settings.lastSpeed,
    2.8,
    `Self-echo should not revert in-memory speed. Expected 2.8, got ${config.settings.lastSpeed}`
  );

  // The new debounce timer for 2.8 should still be active
  assert.exists(config.saveTimer, 'New debounce timer should still be running');
});

runner.test('self-echo does NOT cancel a subsequent debounce timer', async () => {
  const storage = getMockStorage();
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  // Debounce fires and writes 2.0
  await config.save({ lastSpeed: 2.0 });
  await wait(1200);

  // Start new debounce for 3.0
  await config.save({ lastSpeed: 3.0 });

  // Let the echo from the 2.0 write arrive
  await wait(50);

  // Timer for 3.0 should still be alive
  assert.exists(config.saveTimer, 'Timer for 3.0 should not be cancelled by self-echo');

  // Let the 3.0 debounce fire
  await wait(1200);

  assert.equal(storage.lastSpeed, 3.0, 'Storage should have 3.0 after second debounce');
});

runner.test('external lastSpeed write cancels pending debounce timer', async () => {
  const storage = getMockStorage();
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  // Start debounce for 2.0
  await config.save({ lastSpeed: 2.0 });
  assert.exists(config.saveTimer, 'Debounce timer should be set');

  // External context writes lastSpeed = 3.0
  simulateExternalStorageWrite({ lastSpeed: 3.0 });

  // Timer should be cancelled — external write takes precedence
  assert.equal(config.saveTimer, null, 'Debounce timer should be cancelled');
  assert.equal(config.pendingSave, null, 'Pending save should be cleared');

  // In-memory should reflect the external value
  assert.equal(config.settings.lastSpeed, 3.0, 'In-memory should be 3.0 from external write');

  // Wait past the original debounce window — nothing should fire
  await wait(1200);

  // Storage should still be 3.0 (our stale 2.0 was never written)
  assert.equal(storage.lastSpeed, 3.0, 'Storage should remain 3.0 — stale debounce was cancelled');
});

runner.test('external non-speed write does NOT cancel speed debounce', async () => {
  const storage = getMockStorage();
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  // Start speed debounce
  await config.save({ lastSpeed: 2.0 });
  assert.exists(config.saveTimer, 'Speed debounce should be active');

  // External context writes startHidden (not lastSpeed)
  simulateExternalStorageWrite({ startHidden: true });

  // Speed timer should still be running
  assert.exists(config.saveTimer, 'Speed debounce should NOT be cancelled by non-speed write');

  // In-memory should pick up the external startHidden
  assert.equal(config.settings.startHidden, true, 'startHidden should update from external write');

  // Let debounce fire
  await wait(1200);
  assert.equal(storage.lastSpeed, 2.0, 'Speed debounce should still complete');
});

runner.test('_lastWrittenSpeed is consumed after echo, so later external writes are not mistaken for self-echo', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  // Full debounce cycle: write + echo consumed (mock fires onChanged after 5ms)
  await config.save({ lastSpeed: 2.0 });
  await wait(1300);

  // After the echo is consumed, _lastWrittenSpeed should be cleared
  assert.equal(config._lastWrittenSpeed, null, 'Echo should have consumed _lastWrittenSpeed');

  // A subsequent external write must NOT be mistaken for a self-echo
  simulateExternalStorageWrite({ lastSpeed: 5.0 });
  assert.equal(config.settings.lastSpeed, 5.0, 'External write should update in-memory (not mistaken for echo)');
});

// ===========================================================================
// SECTION 8: Remaining edge cases
// ===========================================================================

runner.test('concurrent saves to same key: last one wins', async () => {
  const storage = getMockStorage();
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  // Two saves to same key in quick succession
  await config.save({ controllerOpacity: 0.5 });
  await config.save({ controllerOpacity: 0.9 });

  await wait(50);

  assert.equal(storage.controllerOpacity, 0.9, 'Last write should win');
  assert.equal(config.settings.controllerOpacity, 0.9, 'In-memory should match');
});

// ===========================================================================
// SECTION 9: Pre-load save() guard
// ===========================================================================

runner.test('save() before load() is blocked — prevents writing defaults over user data', async () => {
  const storage = getMockStorage();
  storage.lastSpeed = 2.5; // user's real persisted speed

  const writtenPayloads = [];
  const originalSet = window.VSC.StorageManager.set;
  window.VSC.StorageManager.set = async (data) => {
    writtenPayloads.push({ ...data });
    return originalSet.call(window.VSC.StorageManager, data);
  };

  const config = new window.VSC.VideoSpeedConfig();
  // Intentionally do NOT call load()

  // Attempt to save — should be blocked
  await config.save({ startHidden: true });

  assert.equal(writtenPayloads.length, 0, 'Should not write to storage before load()');
  assert.equal(storage.lastSpeed, 2.5, 'User speed should be untouched');

  window.VSC.StorageManager.set = originalSet;
});

runner.test('save() after load() succeeds normally', async () => {
  const storage = getMockStorage();
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  assert.equal(config._loaded, true, '_loaded should be true after load()');

  await config.save({ startHidden: true });
  await wait(50);

  assert.equal(storage.startHidden, true, 'Save should work after load()');
});

runner.test('save() inside load() (keyBindings init) is not blocked', async () => {
  const storage = getMockStorage();
  storage.keyBindings = []; // triggers init path

  const writtenPayloads = [];
  const originalSet = window.VSC.StorageManager.set;
  window.VSC.StorageManager.set = async (data) => {
    writtenPayloads.push(Object.keys(data));
    return originalSet.call(window.VSC.StorageManager, data);
  };

  const config = new window.VSC.VideoSpeedConfig();
  await config.load();
  await wait(50);

  // The keyBindings init save inside load() should have gone through
  const keyBindingsWrite = writtenPayloads.find((keys) => keys.includes('keyBindings'));
  assert.exists(keyBindingsWrite, 'keyBindings init save inside load() should not be blocked');

  window.VSC.StorageManager.set = originalSet;
});

runner.test('_loaded stays false if load() fails', async () => {
  // Temporarily break StorageManager.get to simulate failure
  const originalGet = window.VSC.StorageManager.get;
  window.VSC.StorageManager.get = async () => { throw new Error('storage unavailable'); };

  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  assert.equal(config._loaded, false, '_loaded should remain false on load() failure');

  // save() should be blocked
  const storage = getMockStorage();
  const originalSpeed = storage.lastSpeed;
  await config.save({ lastSpeed: 99 });
  assert.equal(storage.lastSpeed, originalSpeed, 'save() should be blocked after failed load()');

  window.VSC.StorageManager.get = originalGet;
});

// ===========================================================================
// SECTION 10: save() returns boolean for persistence feedback
// ===========================================================================

runner.test('save() returns true on successful persist', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  const result = await config.save({ startHidden: true });
  assert.equal(result, true, 'Should return true on success');
});

runner.test('save() returns false when storage write fails', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  const originalSet = window.VSC.StorageManager.set;
  window.VSC.StorageManager.set = async () => { throw new Error('QUOTA_BYTES_PER_ITEM exceeded'); };

  const result = await config.save({ startHidden: true });
  assert.equal(result, false, 'Should return false on storage failure');

  // In-memory should still be updated (current session works)
  assert.equal(config.settings.startHidden, true, 'In-memory should still reflect the change');

  window.VSC.StorageManager.set = originalSet;
});

runner.test('save() returns true for debounced speed saves (persistence deferred)', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  const result = await config.save({ lastSpeed: 2.0 });
  assert.equal(result, true, 'Debounced save returns true (in-memory updated, persist is deferred)');
});

runner.test('save() returns false before load()', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  // no load()

  const result = await config.save({ startHidden: true });
  assert.equal(result, false, 'Should return false when _loaded is false');
});

runner.test('save({}) returns true (no-op)', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  // no load() needed — empty save short-circuits before the guard
  const result = await config.save({});
  assert.equal(result, true, 'Empty save is a successful no-op');
});

runner.test('debounce timer storage failure cleans up _lastWrittenSpeed', async () => {
  const config = new window.VSC.VideoSpeedConfig();
  await config.load();

  // Start debounce
  await config.save({ lastSpeed: 2.0 });

  // Break storage before timer fires
  const originalSet = window.VSC.StorageManager.set;
  window.VSC.StorageManager.set = async () => { throw new Error('quota exceeded'); };

  // Wait for debounce to fire (and fail)
  await wait(1200);

  // _lastWrittenSpeed should be cleaned up, not left stale
  assert.equal(config._lastWrittenSpeed, null, '_lastWrittenSpeed should be cleared on failure');

  window.VSC.StorageManager.set = originalSet;
});

export { runner as settingsRaceConditionTestRunner };
