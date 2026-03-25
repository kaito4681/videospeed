/**
 * Default CSS for controller site-specific positioning overrides.
 *
 * Shared by content-entry.js (injects before inject.js for timing safety)
 * and constants.js (exposes on window.VSC.Constants for options page).
 *
 * The BASE vsc-controller rule (position:absolute, visibility, etc.) lives
 * in inject.css — loaded via manifest before any JS runs. This module
 * contains only site-specific overrides that layer on top.
 *
 * Domain-based rules use the --vsc-domain CSS variable set on :root.
 * The variable holds the bare hostname (www. stripped).
 *
 * Pure ES module — no window/DOM dependencies.
 */

export const DEFAULT_CONTROLLER_CSS = `/* === Domain-based rules (stable — hostname only) === */

/* Facebook */
:root[style*='--vsc-domain: "facebook.com"'] vsc-controller {
  position: relative;
  top: 40px;
}

/* Google Photos — inline preview */
:root[style*='--vsc-domain: "photos.google.com"'] vsc-controller {
  position: relative;
  top: 35px;
}

/* Google Photos — full-screen view */
:root[style*='--vsc-domain: "photos.google.com"'] #player .house-brand vsc-controller {
  top: 50px;
}

/* Netflix */
:root[style*='--vsc-domain: "netflix.com"'] vsc-controller {
  position: relative;
  top: 85px;
}

/* Google Drive */
:root[style*='--vsc-domain: "drive.google.com"'] vsc-controller {
  position: relative;
  top: 10px;
}

/* ChatGPT */
:root[style*='--vsc-domain: "chatgpt.com"'] vsc-controller {
  position: relative;
  top: 0px;
  left: 35px;
}

/* === DOM-contextual rules (may break if site changes HTML structure) === */

/* YouTube — shifts controller below info bar when hidden */
.ytp-hide-info-bar vsc-controller {
  position: relative;
  top: 10px;
}

/* YouTube — shifts below paid promotion overlay when visible */
.ytp-hide-info-bar:has(.ytp-paid-content-overlay-link:not([style*="display: none"])) vsc-controller {
  top: 40px;
}

/* YouTube embedded player (on third-party sites) */
.html5-video-player:not(.ytp-hide-info-bar) vsc-controller,
#player > vsc-controller {
  position: relative;
  top: 60px;
}

/* OpenAI — prevent black overlay */
.Shared-Video-player > vsc-controller {
  height: 0 !important;
}

/* Amazon Prime Video — prevent black overlay */
.dv-player-fullscreen vsc-controller {
  height: 0 !important;
}`;
