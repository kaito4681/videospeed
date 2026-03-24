/**
 * Options page - depends on core VSC modules
 * Import required dependencies that are normally bundled in inject context
 */

// Core utilities and constants - must load first
import '../../utils/constants.js';
import '../../utils/logger.js';

// Storage and settings - depends on utils  
import '../../core/storage-manager.js';
import '../../core/settings.js';

// Initialize global namespace for options page
window.VSC = window.VSC || {};

// Debounce utility function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

var keyBindings = [];

// TODO(v3): Remove keyCodeAliases once all bindings have displayKey field
// and the legacy `key` integer field is dropped from the schema.
var keyCodeAliases = {
  0: "null", null: "null", undefined: "null",
  32: "Space", 37: "Left", 38: "Up", 39: "Right", 40: "Down",
  96: "Num 0", 97: "Num 1", 98: "Num 2", 99: "Num 3", 100: "Num 4",
  101: "Num 5", 102: "Num 6", 103: "Num 7", 104: "Num 8", 105: "Num 9",
  106: "Num *", 107: "Num +", 109: "Num -", 110: "Num .", 111: "Num /",
  112: "F1", 113: "F2", 114: "F3", 115: "F4", 116: "F5", 117: "F6",
  118: "F7", 119: "F8", 120: "F9", 121: "F10", 122: "F11", 123: "F12",
  124: "F13", 125: "F14", 126: "F15", 127: "F16", 128: "F17", 129: "F18",
  130: "F19", 131: "F20", 132: "F21", 133: "F22", 134: "F23", 135: "F24",
  186: ";", 188: "<", 189: "-", 187: "+", 190: ">", 191: "/", 192: "~",
  219: "[", 220: "\\", 221: "]", 222: "'",
};

// Keyboard layout map — resolved once on page load, used for display labels
let layoutMap = null;
(async function initLayoutMap() {
  try {
    if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
      layoutMap = await navigator.keyboard.getLayoutMap();
      // Re-render display labels if layout changes mid-session
      navigator.keyboard.addEventListener('layoutchange', async () => {
        layoutMap = await navigator.keyboard.getLayoutMap();
      });
    }
  } catch (e) {
    // getLayoutMap not available — fallback chain handles it
  }
})();

/**
 * Build a display string for a shortcut.
 * @param {string} displayKey - event.key captured at recording time
 * @param {Object} [modifiers] - {ctrl, alt, shift, meta} booleans
 * @returns {string} e.g., "Ctrl + S", "Shift + P", "F10"
 */
function formatShortcutDisplay(displayKey, modifiers) {
  if (!displayKey) return 'null';
  const parts = [];
  if (modifiers) {
    if (modifiers.ctrl) parts.push('Ctrl');
    if (modifiers.alt) parts.push('Alt');
    if (modifiers.shift) parts.push('Shift');
    if (modifiers.meta) parts.push('Meta');
  }
  // Capitalize single-character keys for display
  const label = displayKey.length === 1 ? displayKey.toUpperCase() : displayKey;
  parts.push(label);
  return parts.join(' + ');
}

/**
 * Resolve the best display label for a binding.
 * Fallback chain: layoutMap → displayKey → keyCodeAliases → code → "null"
 */
function resolveDisplayLabel(binding) {
  // Try layout map first (most accurate for current keyboard)
  if (layoutMap && binding.code) {
    const mapped = layoutMap.get(binding.code);
    if (mapped) return formatShortcutDisplay(mapped, binding.modifiers);
  }
  // v2 binding with displayKey
  if (binding.displayKey) {
    return formatShortcutDisplay(binding.displayKey, binding.modifiers);
  }
  // v2 binding with code but no displayKey
  if (binding.code) {
    const derived = window.VSC.Constants.displayKeyFromCode(binding.code);
    return formatShortcutDisplay(derived, binding.modifiers);
  }
  // Legacy v1 binding — fall back to keyCodeAliases
  const kc = binding.keyCode ?? binding.key;
  return keyCodeAliases[kc] ||
    (kc >= 48 && kc <= 90 ? String.fromCharCode(kc) : `Key ${kc}`);
}

/**
 * Auto-size a key input to fit chord labels like "Ctrl + Shift + S".
 * Falls back to 75px minimum for simple keys.
 */
function autoSizeKeyInput(input) {
  const minWidth = 75;
  if (!input.value || input.value.length <= 3) {
    input.style.width = minWidth + 'px';
    return;
  }
  const span = document.createElement('span');
  span.style.visibility = 'hidden';
  span.style.position = 'absolute';
  span.style.font = getComputedStyle(input).font;
  span.style.whiteSpace = 'nowrap';
  span.textContent = input.value;
  document.body.appendChild(span);
  const textWidth = span.offsetWidth;
  document.body.removeChild(span);
  input.style.width = Math.max(minWidth, textWidth + 26) + 'px';
}

function recordKeyPress(e) {
  // Special handling for backspace and escape (via event.code)
  if (e.code === 'Backspace') {
    e.target.value = "";
    e.target.code = null;
    e.target.keyCode = null;
    e.target.displayKey = null;
    e.target.modifiers = undefined;
    e.preventDefault();
    e.stopPropagation();
    return;
  } else if (e.code === 'Escape') {
    e.target.value = "null";
    e.target.code = null;
    e.target.keyCode = null;
    e.target.displayKey = null;
    e.target.modifiers = undefined;
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // Block blacklisted codes
  if (window.VSC.Constants.BLACKLISTED_CODES.has(e.code)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // Capture v2 identity
  e.target.code = e.code;
  e.target.keyCode = e.keyCode;
  e.target.displayKey = e.key;

  // Capture modifiers — only store object if any modifier is active
  const hasMod = e.ctrlKey || e.altKey || e.shiftKey || e.metaKey;
  e.target.modifiers = hasMod ? {
    ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey,
  } : undefined;

  // Display formatted shortcut
  e.target.value = formatShortcutDisplay(e.key, e.target.modifiers);
  autoSizeKeyInput(e.target);

  // Show contextual warnings for problematic modifier combos
  clearWarning(e.target);
  if (e.ctrlKey && e.altKey) {
    showWarning(e.target, 'This combination may conflict with AltGr input on some keyboard layouts.');
  } else if (e.metaKey) {
    showWarning(e.target, 'Some Cmd/Meta combinations are intercepted by the OS and may not work.');
  }

  e.preventDefault();
  e.stopPropagation();
}

function showWarning(input, message) {
  clearWarning(input);
  const warn = document.createElement('span');
  warn.className = 'shortcut-warning';
  warn.textContent = message;
  warn.style.cssText = 'display:block;color:#c57600;font-size:11px;margin-top:2px;';
  input.parentNode.insertBefore(warn, input.nextSibling);
}

function clearWarning(input) {
  const existing = input.parentNode.querySelector('.shortcut-warning');
  if (existing) existing.remove();
}

function inputFilterNumbersOnly(e) {
  if ((e.inputType === 'insertText' || e.inputType === 'insertFromPaste') && e.data) {
    if (!/^\d+(\.\d*)?$/.test(e.target.value + e.data)) {
      e.preventDefault();
    }
  }
}

function inputFocus(e) {
  e.target.value = "";
}

function inputBlur(e) {
  // Reconstruct display from stored v2 fields, falling back to legacy
  if (e.target.code) {
    e.target.value = formatShortcutDisplay(
      e.target.displayKey || window.VSC.Constants.displayKeyFromCode(e.target.code),
      e.target.modifiers
    );
  } else if (e.target.code === null) {
    e.target.value = 'null';
  } else {
    // Legacy fallback
    const kc = e.target.keyCode;
    e.target.value = keyCodeAliases[kc] ||
      (kc >= 48 && kc <= 90 ? String.fromCharCode(kc) : `Key ${kc}`);
  }
  autoSizeKeyInput(e.target);
}

/**
 * Populate a shortcut input element with binding data.
 * Sets all v2 fields on the DOM element for round-trip through createKeyBindings.
 */
function setShortcutInput(input, binding) {
  input.code = binding.code;
  input.keyCode = binding.keyCode ?? binding.key;
  input.displayKey = binding.displayKey;
  input.modifiers = binding.modifiers;
  input.value = resolveDisplayLabel(binding);
  autoSizeKeyInput(input);
}


function add_shortcut() {
  var html = `<select class="customDo">
    <option value="slower">Decrease speed</option>
    <option value="faster">Increase speed</option>
    <option value="rewind">Rewind</option>
    <option value="advance">Advance</option>
    <option value="reset">Reset speed</option>
    <option value="fast">Preferred speed</option>
    <option value="muted">Mute</option>
    <option value="softer">Decrease volume</option>
    <option value="louder">Increase volume</option>
    <option value="pause">Pause</option>
    <option value="mark">Set marker</option>
    <option value="jump">Jump to marker</option>
    <option value="display">Show/hide controller</option>
    </select>
    <input class="customKey" type="text" placeholder="press a key"/>
    <input class="customValue" type="text" placeholder="value (0.10)"/>
    <button class="removeParent">X</button>`;
  var div = document.createElement("div");
  div.setAttribute("class", "row customs");
  div.innerHTML = html;
  var customs_element = document.getElementById("customs");
  customs_element.insertBefore(
    div,
    customs_element.children[customs_element.childElementCount - 1]
  );

  // If experimental features are already enabled, add the force select
  const experimentalButton = document.getElementById("experimental");
  if (experimentalButton && experimentalButton.disabled) {
    const customValue = div.querySelector('.customValue');
    const select = document.createElement('select');
    select.className = 'customForce show';
    select.innerHTML = `
      <option value="false">Default behavior</option>
      <option value="true">Override site keys</option>
    `;
    customValue.parentNode.insertBefore(select, customValue.nextSibling);
  }
}

function createKeyBindings(item) {
  const action = item.querySelector(".customDo").value;
  const input = item.querySelector(".customKey");
  const value = Number(item.querySelector(".customValue").value);
  const forceElement = item.querySelector(".customForce");
  const force = forceElement ? forceElement.value === 'true' : false;
  const predefined = !!item.id;

  const binding = {
    action: action,
    code: input.code,                     // PRIMARY — event.code string
    key: input.keyCode,                   // OLD field name — integer, downgrade compat
    keyCode: input.keyCode,               // NEW field name — canonical legacy integer
    displayKey: input.displayKey,         // display-friendly from event.key
    value: value,
    force: force,
    predefined: predefined,
  };

  // Only include modifiers when at least one is true
  if (input.modifiers) {
    binding.modifiers = input.modifiers;
  }

  keyBindings.push(binding);
}

// Validates settings before saving
function validate() {
  var valid = true;
  var status = document.getElementById("status");
  var blacklist = document.getElementById("blacklist");

  // Clear any existing timeout for validation errors
  if (window.validationTimeout) {
    clearTimeout(window.validationTimeout);
  }

  blacklist.value.split("\n").forEach((match) => {
    match = match.replace(window.VSC.Constants.regStrip, "");

    if (match.startsWith("/")) {
      try {
        var parts = match.split("/");

        if (parts.length < 3)
          throw "invalid regex";

        var flags = parts.pop();
        var regex = parts.slice(1).join("/");

        var regexp = new RegExp(regex, flags);
      } catch (err) {
        status.textContent =
          "Error: Invalid blacklist regex: \"" + match + "\". Unable to save. Try wrapping it in foward slashes.";
        status.classList.add("show", "error");
        valid = false;

        // Auto-hide validation error after 5 seconds
        window.validationTimeout = setTimeout(function () {
          status.textContent = "";
          status.classList.remove("show", "error");
        }, 5000);

        return;
      }
    }
  });
  return valid;
}

// Saves options using VideoSpeedConfig system
async function save_options() {
  if (validate() === false) {
    return;
  }

  var status = document.getElementById("status");
  status.textContent = "Saving...";
  status.classList.remove("success", "error");
  status.classList.add("show");

  try {
    keyBindings = [];
    Array.from(document.querySelectorAll(".customs")).forEach((item) =>
      createKeyBindings(item)
    );

    var rememberSpeed = document.getElementById("rememberSpeed").checked;
    var forceLastSavedSpeed = document.getElementById("forceLastSavedSpeed").checked;
    var audioBoolean = document.getElementById("audioBoolean").checked;
    var startHidden = document.getElementById("startHidden").checked;
    var controllerOpacity = Number(document.getElementById("controllerOpacity").value);
    var controllerButtonSize = Number(document.getElementById("controllerButtonSize").value);
    var logLevel = parseInt(document.getElementById("logLevel").value);
    var blacklist = document.getElementById("blacklist").value;

    // Ensure VideoSpeedConfig singleton is initialized
    if (!window.VSC.videoSpeedConfig) {
      window.VSC.videoSpeedConfig = new window.VSC.VideoSpeedConfig();
    }

    // Use VideoSpeedConfig to save settings
    const settingsToSave = {
      rememberSpeed: rememberSpeed,
      forceLastSavedSpeed: forceLastSavedSpeed,
      audioBoolean: audioBoolean,
      startHidden: startHidden,
      controllerOpacity: controllerOpacity,
      controllerButtonSize: controllerButtonSize,
      logLevel: logLevel,
      keyBindings: keyBindings,
      blacklist: blacklist.replace(window.VSC.Constants.regStrip, "")
    };

    const ok = await window.VSC.videoSpeedConfig.save(settingsToSave);

    if (ok) {
      status.textContent = "Options saved";
      status.classList.add("success");
    } else {
      status.textContent = "Error: failed to save options to storage";
      status.classList.add("error");
    }
    setTimeout(function () {
      status.textContent = "";
      status.classList.remove("show", "success", "error");
    }, ok ? 2000 : 3000);

  } catch (error) {
    console.error("Failed to save options:", error);
    status.textContent = "Error saving options: " + error.message;
    status.classList.add("show", "error");
    setTimeout(function () {
      status.textContent = "";
      status.classList.remove("show", "error");
    }, 3000);
  }
}

// Restores options using VideoSpeedConfig system
async function restore_options() {
  try {
    // Ensure VideoSpeedConfig singleton is initialized
    if (!window.VSC.videoSpeedConfig) {
      window.VSC.videoSpeedConfig = new window.VSC.VideoSpeedConfig();
    }

    // Load settings using VideoSpeedConfig
    await window.VSC.videoSpeedConfig.load();
    const storage = window.VSC.videoSpeedConfig.settings;

    document.getElementById("rememberSpeed").checked = storage.rememberSpeed;
    document.getElementById("forceLastSavedSpeed").checked = storage.forceLastSavedSpeed;
    document.getElementById("audioBoolean").checked = storage.audioBoolean;
    document.getElementById("startHidden").checked = storage.startHidden;
    document.getElementById("controllerOpacity").value = storage.controllerOpacity;
    document.getElementById("controllerButtonSize").value = storage.controllerButtonSize;
    document.getElementById("logLevel").value = storage.logLevel;
    document.getElementById("blacklist").value = storage.blacklist;

    // Process key bindings
    const keyBindings = storage.keyBindings || window.VSC.Constants.DEFAULT_SETTINGS.keyBindings;

    for (let i in keyBindings) {
      var item = keyBindings[i];

      if (item.predefined) {
        // Handle predefined shortcuts
        if (window.VSC.Constants.CUSTOM_ACTIONS_NO_VALUES.includes(item["action"])) {
          const valueInput = document.querySelector("#" + item["action"] + " .customValue");
          if (valueInput) {
            valueInput.style.display = "none";
          }
        }

        const keyInput = document.querySelector("#" + item["action"] + " .customKey");
        const valueInput = document.querySelector("#" + item["action"] + " .customValue");
        const forceInput = document.querySelector("#" + item["action"] + " .customForce");

        if (keyInput) {
          setShortcutInput(keyInput, item);
        }
        if (valueInput) {
          valueInput.value = item["value"];
        }
        if (forceInput) {
          forceInput.value = String(item["force"]);
        }
      } else {
        // Handle custom shortcuts
        add_shortcut();
        const dom = document.querySelector(".customs:last-of-type");
        dom.querySelector(".customDo").value = item["action"];

        if (window.VSC.Constants.CUSTOM_ACTIONS_NO_VALUES.includes(item["action"])) {
          const valueInput = dom.querySelector(".customValue");
          if (valueInput) {
            valueInput.style.display = "none";
          }
        }

        setShortcutInput(dom.querySelector(".customKey"), item);
        dom.querySelector(".customValue").value = item["value"];
        // If force value exists in settings but element doesn't exist, create it
        if (item["force"] !== undefined && !dom.querySelector(".customForce")) {
          const customValue = dom.querySelector('.customValue');
          const select = document.createElement('select');
          select.className = 'customForce'; // Don't add 'show' class initially
          select.innerHTML = `
            <option value="false">Default behavior</option>
            <option value="true">Override site keys</option>
          `;
          select.value = String(item["force"]);
          customValue.parentNode.insertBefore(select, customValue.nextSibling);
        } else {
          const forceSelect = dom.querySelector(".customForce");
          if (forceSelect) {
            forceSelect.value = String(item["force"]);
          }
        }
      }
    }

    // Check if any keybindings have force property set, if so, show experimental features
    const hasExperimentalFeatures = keyBindings.some(kb => kb.force !== undefined && kb.force !== false);
    if (hasExperimentalFeatures) {
      show_experimental();
    }
  } catch (error) {
    console.error("Failed to restore options:", error);
    document.getElementById("status").textContent = "Error loading options: " + error.message;
    document.getElementById("status").classList.add("show", "error");
    setTimeout(function () {
      document.getElementById("status").textContent = "";
      document.getElementById("status").classList.remove("show", "error");
    }, 3000);
  }
}

async function restore_defaults() {
  try {
    var status = document.getElementById("status");
    status.textContent = "Restoring defaults...";
    status.classList.remove("success", "error");
    status.classList.add("show");

    // Clear all storage
    await window.VSC.StorageManager.clear();

    // Ensure VideoSpeedConfig singleton is initialized
    if (!window.VSC.videoSpeedConfig) {
      window.VSC.videoSpeedConfig = new window.VSC.VideoSpeedConfig();
    }

    const defaults = { ...window.VSC.Constants.DEFAULT_SETTINGS, schemaVersion: 2 };
    const ok = await window.VSC.videoSpeedConfig.save(defaults);
    if (!ok) throw new Error('failed to write defaults to storage');

    // Remove custom shortcuts from UI
    document
      .querySelectorAll(".removeParent")
      .forEach((button) => button.click());

    // Reload the options page
    await restore_options();

    status.textContent = "Default options restored";
    status.classList.add("success");
    setTimeout(function () {
      status.textContent = "";
      status.classList.remove("show", "success");
    }, 2000);
  } catch (error) {
    console.error("Failed to restore defaults:", error);
    status.textContent = "Error restoring defaults: " + error.message;
    status.classList.add("show", "error");
    setTimeout(function () {
      status.textContent = "";
      status.classList.remove("show", "error");
    }, 3000);
  }
}

function show_experimental() {
  const button = document.getElementById("experimental");
  const customRows = document.querySelectorAll('.row.customs');
  const advancedRows = document.querySelectorAll('.row.advanced-feature');

  // Show advanced feature rows
  advancedRows.forEach((row) => {
    row.classList.add('show');
  });

  // Create the select template
  const createForceSelect = () => {
    const select = document.createElement('select');
    select.className = 'customForce show';
    select.innerHTML = `
      <option value="false">Allow event propagation</option>
      <option value="true">Disable event propagation</option>
    `;
    return select;
  };

  // Add select to each row
  customRows.forEach((row) => {
    const existingSelect = row.querySelector('.customForce');

    if (!existingSelect) {
      // Create new select if it doesn't exist
      const customValue = row.querySelector('.customValue');
      const newSelect = createForceSelect();

      // Check if this row has saved force value
      const rowId = row.id;
      if (rowId && window.VSC.videoSpeedConfig && window.VSC.videoSpeedConfig.settings.keyBindings) {
        // For predefined shortcuts
        const savedBinding = window.VSC.videoSpeedConfig.settings.keyBindings.find(kb => kb.action === rowId);
        if (savedBinding && savedBinding.force !== undefined) {
          newSelect.value = String(savedBinding.force);
        }
      } else if (!rowId) {
        // For custom shortcuts, try to find the force value from the current keyBindings array
        const rowIndex = Array.from(row.parentElement.querySelectorAll('.row.customs:not([id])')).indexOf(row);
        const customBindings = window.VSC.videoSpeedConfig?.settings.keyBindings?.filter(kb => !kb.predefined) || [];
        if (customBindings[rowIndex] && customBindings[rowIndex].force !== undefined) {
          newSelect.value = String(customBindings[rowIndex].force);
        }
      }

      // Insert after the customValue input
      if (customValue) {
        customValue.parentNode.insertBefore(newSelect, customValue.nextSibling);
      }
    } else {
      // If it already exists, just show it
      existingSelect.classList.add('show');
    }
  });

  // Update button text to indicate the feature is now enabled
  button.textContent = "Advanced features enabled";
  button.disabled = true;
}

// Create debounced save function to prevent rapid saves
const debouncedSave = debounce(save_options, 300);

document.addEventListener("DOMContentLoaded", async function () {
  // Optional: Set up storage error monitoring for debugging/telemetry
  window.VSC.StorageManager.onError((error, data) => {
    // Log to console for debugging, could also send telemetry
    console.warn('Storage operation failed:', error.message, data);
  });

  await restore_options();

  // Disable action dropdowns for predefined shortcuts
  document.querySelectorAll('.row.customs[id] .customDo').forEach(select => {
    select.disabled = true;
  });

  document.getElementById("save").addEventListener("click", async (e) => {
    e.preventDefault();
    await save_options();
  });

  document.getElementById("add").addEventListener("click", add_shortcut);

  document.getElementById("restore").addEventListener("click", async (e) => {
    e.preventDefault();
    await restore_defaults();
  });

  document.getElementById("experimental").addEventListener("click", show_experimental);

  // About and feedback button event listeners
  document.getElementById("about").addEventListener("click", function () {
    window.open("https://github.com/igrigorik/videospeed");
  });

  document.getElementById("feedback").addEventListener("click", function () {
    window.open("https://github.com/igrigorik/videospeed/issues");
  });

  function eventCaller(event, className, funcName) {
    if (!event.target.classList.contains(className)) {
      return;
    }
    funcName(event);
  }

  document.addEventListener("beforeinput", (event) => {
    eventCaller(event, "customValue", inputFilterNumbersOnly);
  });
  document.addEventListener("focus", (event) => {
    eventCaller(event, "customKey", inputFocus);
  });
  document.addEventListener("blur", (event) => {
    eventCaller(event, "customKey", inputBlur);
  });
  document.addEventListener("keydown", (event) => {
    eventCaller(event, "customKey", recordKeyPress);
  });
  document.addEventListener("click", (event) => {
    eventCaller(event, "removeParent", function () {
      event.target.parentNode.remove();
    });
  });
  document.addEventListener("change", (event) => {
    eventCaller(event, "customDo", function () {
      const valueInput = event.target.nextElementSibling.nextElementSibling;
      if (window.VSC.Constants.CUSTOM_ACTIONS_NO_VALUES.includes(event.target.value)) {
        valueInput.style.display = "none";
        valueInput.value = 0;
      } else {
        valueInput.style.display = "inline-block";
      }
    });
  });
});
