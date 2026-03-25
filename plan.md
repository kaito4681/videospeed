# Fix Controller Positioning: Analysis & Plan

## Problem Statement

The refactor in `fecbe0d` moved positioning from the inner `#controller` (shadow DOM) to the outer `<vsc-controller>` wrapper (light DOM) with `position: absolute !important` as an inline style. This broke every CSS site override in inject.css — inline `!important` beats any authored CSS rule, so `position: relative; top: 60px` (the mechanism that made YouTube embeds, Netflix, Facebook, etc. work) became dead code.

The controller now lands at computed absolute coordinates on all sites. Sites where those coordinates happen to be close enough look fine. Sites where they're wrong (YouTube embedded, visible in the DOM dump from igvita.com) show the controller overlapping player chrome.

## Root Cause

### Before refactor (v0.7.4 — worked)

```
<div class="vsc-controller">        ← NO inline styles. Position controlled by CSS.
  #shadow-root
    <div id="controller"            ← position:absolute; top:Xpx; left:Xpx (computed)
         style="top:${top}; left:${left}; opacity:${opacity}">
```

- Wrapper had zero inline styles
- CSS overrides set `position: relative; top: 60px` on wrapper → worked because nothing fought it
- Inner `#controller` was `position: absolute` (from shadow.css) with computed `top`/`left`
- When CSS made wrapper `relative`, inner controller positioned relative to wrapper at ~(0,0)
- When wrapper was `static` (default), inner controller positioned relative to nearest positioned ancestor
- Drag modified inner `#controller`'s `top`/`left` — same element that held computed position
- z-index was on inner `#controller` via shadow.css, not on wrapper

### After refactor (fecbe0d — broken)

```
<vsc-controller                     ← position:absolute !important; top:Xpx; left:Xpx (inline)
     style="position: absolute !important; z-index: 9999999 !important; top: 0px; left: 0px;">
  #shadow-root
    <div id="controller"            ← top:0; left:0 (hardcoded zeros)
         style="top:0px; left:0px; opacity:0.3">
```

- Wrapper gets `position: absolute !important` inline — kills all CSS overrides
- Computed `top`/`left` moved from inner controller to wrapper
- Inner `#controller` hardcoded to `top:0; left:0`
- Drag still modifies inner `#controller`'s position (now offset FROM the wrapper's position — confusing)
- Additionally: `calculatePosition()` runs BEFORE `insertIntoDOM()` (line 97 vs 149), using `video.offsetParent` which may differ from where the wrapper actually lands

### What broke

| inject.css rule | Target | Why broken |
|---|---|---|
| 8 `position: relative` rules (YT, Netflix, FB, etc.) | wrapper | Inline `position: absolute !important` wins |
| 2 `height: 0` rules (OpenAI, Amazon) | wrapper | Base rule `height: auto !important` wins |
| ChatGPT `position: relative !important` | wrapper | Inline `!important` beats CSS `!important` (same origin, inline wins) |

Total: 11 of 13 rules targeting our element are broken.

## Design: The Positioning Contract

### Two-layer model (restored from old architecture)

```
LIGHT DOM (inject.css controls)          SHADOW DOM (shadow CSS + inline)
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ <vsc-controller>             │        │ #controller                  │
│                              │        │                              │
│ Inline: z-index ONLY         │───────>│ Inline: top, left, opacity   │
│ Position: determined by CSS  │        │ CSS: position: absolute      │
│   default: static            │        │                              │
│   site override: relative    │        │ Drag: modifies top/left here │
│                              │        │ Visibility: :host() rules    │
└──────────────────────────────┘        └──────────────────────────────┘
```

### Contract rules

1. **Wrapper inline styles**: `z-index: 9999999 !important` — NOTHING ELSE. No position, no top, no left.

2. **Wrapper position is CSS-controlled**:
   - Default: `static` (no rule needed — browser default)
   - Site overrides in inject.css: `position: relative; top: Xpx`
   - Future: site handlers MAY set position via inline style (overrides CSS), but this is optional and deferred

3. **Inner `#controller` position**:
   - Shadow CSS: `position: absolute` (already correct, line 62 of shadow-dom.js)
   - Inline `top`/`left`: computed by `calculatePosition()` OR `(0, 0)` when wrapper is CSS-positioned
   - This is where drag offsets are applied (already correct in drag-handler.js)

4. **Position calculation happens AFTER insertion**:
   - Old bug: `calculatePosition()` ran at line 97, `insertIntoDOM()` at line 149
   - Fix: insert first, then compute position based on actual DOM state
   - After insertion, check `getComputedStyle(wrapper).position`:
     - If `static`: use `calculatePosition(video)` → inner controller positions relative to containing block
     - If not `static` (CSS override active): use `(0, 0)` → CSS nudge on wrapper is the only offset

5. **`calculatePosition()` uses video.offsetParent**: This is correct when wrapper is `static` and inserted near the video (they share the same containing block). When a site handler changes the insertion point to somewhere far from the video, the coordinates could be wrong — but in that case, the site should have a CSS override (which zeros out the computed values via rule 4).

### Why CSS for site overrides (not JS handlers)

- **Declarative**: adding `position: relative; top: 80px` is one line, no JS knowledge needed
- **Already exists**: 8 working rules from pre-refactor, just need to un-break them
- **Separation of concerns**: handlers own WHERE (insertion point), CSS owns HOW (visual positioning)
- **Contributor-friendly**: CSS overrides can be added and tested in devtools, then committed

### Safety net: handler-driven positioning (optional, deferred)

Site handlers MAY return a `positionOverride` in the future:
```js
getControllerPosition(parent, video) {
  return {
    insertionPoint: parent.parentElement,
    insertionMethod: 'firstChild',
    positionOverride: { top: '60px' },  // optional, applied as inline style
  };
}
```

When present, `video-controller.js` applies it as inline styles on the wrapper (inline beats CSS, so handler wins). This is the escape hatch for sites where CSS selectors are too fragile. But it's NOT required for this fix — all current sites work with CSS.

## Detailed Changes

### 1. `src/core/video-controller.js` — fix initializeControls()

**Current code (broken)**:
```js
// line 97: position computed BEFORE insertion
const position = ShadowDOMManager.calculatePosition(this.video);

// lines 124-131: position applied to WRAPPER with !important
const styleText = `
  position: absolute !important;
  z-index: 9999999 !important;
  top: ${position.top};
  left: ${position.left};
`;
wrapper.style.cssText = styleText;

// lines 134-140: inner controller gets hardcoded (0,0)
const shadow = ShadowDOMManager.createShadowDOM(wrapper, {
  top: '0px',
  left: '0px',
  ...
});

// line 149: insertion happens AFTER positioning
this.insertIntoDOM(document, wrapper);
```

**Fixed code**:
```js
// Wrapper gets z-index ONLY — no position, no top, no left
wrapper.style.cssText = 'z-index: 9999999 !important;';

// Create shadow DOM with placeholder position (will be set after insertion)
const shadow = ShadowDOMManager.createShadowDOM(wrapper, {
  top: '0px',
  left: '0px',
  speed: speed,
  opacity: this.config.settings.controllerOpacity,
  buttonSize: this.config.settings.controllerButtonSize,
});

// ... setup controls, store speedIndicator ...

// Insert into DOM FIRST
this.insertIntoDOM(document, wrapper);

// THEN compute and apply position to inner #controller
const innerController = ShadowDOMManager.getController(shadow);
const isPositioned = getComputedStyle(wrapper).position !== 'static';

if (!isPositioned) {
  // No CSS override — compute position for generic sites
  const position = ShadowDOMManager.calculatePosition(this.video);
  innerController.style.top = position.top;
  innerController.style.left = position.left;
}
// else: CSS set wrapper to relative with a nudge.
// Inner controller stays at (0,0), positioning relative to wrapper. Correct.
```

**Why this is safe**: The browser does not repaint between synchronous JS operations. Insert + set position happens in one JS turn — no visual flash.

### 2. `src/styles/inject.css` — clean up

**Remove**:
- Lines 55-58: Vine rules (site shut down 2017)
- Lines 97-99: `section[role="tabpanel"]` (unknown provenance, no linked issue, targets third-party element with no `!important` — likely stale and ineffective)

**Fix**:
- Line 6: `width: auto !important` → `width: auto` (remove `!important` so site-specific overrides can work)
- Line 7: `height: auto !important` → `height: auto` (remove `!important` so `height: 0` rules for OpenAI/Amazon work)
- Lines 103-107: ChatGPT rule — remove `!important` from all three properties (not needed when wrapper has no inline position/top/left)

**Keep as-is** (these all work correctly once the wrapper has no inline position):
- Lines 1-12: Base element defaults (with the `!important` fix above)
- Lines 16-19: YouTube `.ytp-hide-info-bar` override
- Lines 23-26: YouTube embedded override
- Lines 29-32: Facebook override
- Lines 36-39: Google Photos inline override
- Lines 42-45: Google Photos fullscreen override
- Lines 48-51: Netflix override
- Lines 62-68: YouTube 3D spherical control (targets YT's element, not ours)
- Lines 71-73: Vimeo overlay (targets Vimeo's element)
- Lines 76-79: Kickstarter overlay (targets KS's element)
- Lines 82-84: OpenAI `height: 0` (works once base `!important` removed)
- Lines 87-89: Amazon `height: 0` (works once base `!important` removed)
- Lines 92-95: Google Drive override

### 3. `src/ui/shadow-dom.js` — no changes needed

- `createShadowDOM()` already accepts `top`/`left` options and applies them to inner `#controller` (line 161)
- `calculatePosition()` logic is unchanged — it's correct for the `static` wrapper case
- Shadow CSS already has `#controller { position: absolute; top: 0; left: 0; }` (lines 61-64) — the inline `top`/`left` from `createShadowDOM` override these defaults
- `getController()` (line 208) already returns the inner `#controller` element

### 4. `src/site-handlers/base-handler.js` — optional, deferred

Add `positionOverride` to JSDoc for future use. No behavioral change needed now.

### 5. No new site handlers needed

All current site position overrides are CSS rules in inject.css. They work once the wrapper's inline `!important` is removed. No need to create handlers for Google Photos, Google Drive, ChatGPT, or OpenAI.

## Edge Case Analysis

### Case 1: Site handler changes insertion point (e.g., Facebook 7 levels up)

- Handler inserts wrapper far from video's parent
- `calculatePosition()` computes relative to `video.offsetParent`
- But the wrapper's containing block (for the inner `#controller`) is wherever the wrapper lands
- **Mitigation**: Facebook has a CSS override (`#facebook vsc-controller { position: relative; top: 40px }`). When CSS sets the wrapper to `relative`, the post-insertion check detects `position !== 'static'` and skips `calculatePosition()`. Inner controller stays at `(0,0)`, wrapper's CSS nudge handles positioning. Correct.
- **If no CSS override existed**: the computed position would be wrong (coordinates relative to wrong containing block). But every site with a custom insertion point already has a CSS override — that's why both exist.

### Case 2: Site handler uses default insertion (firstChild of parent)

- Wrapper is inserted as firstChild of video's parent
- Both video and wrapper share the same parent → same containing block hierarchy
- `calculatePosition()` uses `video.offsetParent`, which is typically the same positioned ancestor
- Inner controller's absolute position is correct relative to that ancestor
- No CSS override needed. Correct.

### Case 3: CSS override active but video doesn't fill container

- CSS sets wrapper to `position: relative; top: 60px`
- Post-insertion check detects `position !== 'static'`, sets inner controller to `(0,0)`
- What if the video is offset within the container? The inner controller at `(0,0)` positions at the wrapper's top-left, which is at normal flow position + 60px nudge
- The wrapper flows at the top of the container (inserted as firstChild), so the controller appears at the container's top + 60px
- This is the same behavior as the old code. If the video starts further down, the controller won't follow it — but this was also true before, and the CSS nudge values were chosen to work with each site's specific layout. Correct for the same cases as before.

### Case 4: Drag after CSS override

- User drags controller (drag-handler.js modifies inner `#controller` `style.top` and `style.left`)
- Inner controller is `position: absolute` relative to wrapper (which is `position: relative`)
- Drag offsets work correctly — moving within the wrapper's bounds
- Same behavior as old code. Correct.

### Case 5: Drag without CSS override (generic site)

- Wrapper is `static`, inner controller is `position: absolute`
- Drag modifies inner controller's `top`/`left`
- Inner controller positions relative to nearest positioned ancestor (above the wrapper)
- Drag offsets still work — user moves the controller around the positioned ancestor
- Same behavior as old code. Correct.

### Case 6: `height: 0` overrides (OpenAI, Amazon)

- With `height: auto !important` removed from base rule, `height: 0` on `.Shared-Video-player > vsc-controller` now wins (higher specificity, no competing `!important`)
- The wrapper collapses to 0 height, preventing black overlay artifacts
- Inner `#controller` with `position: absolute` still renders (absolute elements aren't clipped by parent height unless `overflow: hidden`)
- Correct.

## Verification Plan

After implementation, verify on these sites:

| Site | Expected behavior | What to check |
|---|---|---|
| YouTube (main) | Controller 10px below top of player | `.ytp-hide-info-bar` CSS override active |
| YouTube (embedded, e.g. igvita.com) | Controller 60px below top (clears title) | `.html5-video-player:not(.ytp-hide-info-bar)` CSS override active |
| Netflix | Controller 85px below top (clears transport) | `#netflix-player` CSS override active |
| Facebook | Controller 40px below top | `#facebook` CSS override active |
| Generic site (e.g. random `<video>`) | Controller at video's top-left corner | `calculatePosition()` path, no CSS override |
| Drag on any site | Controller moves smoothly, stays at new position | Inner `#controller` `top`/`left` updated |
| Amazon Prime Video | No black overlay | `height: 0` rule works |
| ChatGPT | Controller offset 35px left | CSS override with `left: 35px` |

## Review Feedback & Resolutions

Two senior engineers reviewed this plan. Key findings and resolutions:

### R1: Wrapper default should be `position: absolute` in CSS, not `static` (ACCEPTED)

**Both reviewers flagged this.** A `static` wrapper is a block element in normal flow — it can push siblings down and disrupt layout. The old pre-refactor code got away with this because video players typically have `overflow: hidden` on their containers, but it's fragile.

**Resolution**: Add `position: absolute` (NO `!important`) to the base CSS rule in inject.css:

```css
vsc-controller {
  position: absolute;  /* keeps wrapper out of flow; site overrides to relative win via specificity */
  ...
}
```

Site overrides like `.ytp-hide-info-bar vsc-controller { position: relative; }` win because `class + element` specificity beats bare `element`. This:
- Keeps wrapper out of flow on generic sites (no layout disruption)
- Allows CSS overrides to change to `relative` as needed
- Makes `z-index` on wrapper effective (requires non-static position)
- Preserves the intent of the original refactor's `position: absolute` without `!important`

**Impact on post-insertion check**: change from `!== 'static'` to `=== 'relative'` (since default is now `absolute`).

### R2: z-index on a static wrapper is inert (RESOLVED BY R1)

Reviewer 1 noted that `z-index` has no effect on `static`-positioned elements. With R1 adopted (wrapper defaults to `absolute`), z-index works in all cases. The inner `#controller`'s shadow-CSS `z-index: 9999999` provides additional stacking defense.

### R3: Keep `!important` on base `width`/`height`, add `!important` to site overrides instead (ACCEPTED)

**Reviewer 2 flagged this.** Removing `!important` from the base rule exposes width/height to third-party CSS (e.g., `* { height: 100% }`). Better approach:

```css
/* Base — defensive */
vsc-controller { height: auto !important; width: auto !important; }

/* Site overrides — explicit override */
.Shared-Video-player > vsc-controller { height: 0 !important; }
.dv-player-fullscreen vsc-controller { height: 0 !important; }
```

Both `!important` at the same level, site override wins via higher specificity.

### R4: Apple TV+ handler has custom insertion but no CSS override (NOTED)

Apple handler inserts into `parent.parentNode` (one level up) but has no CSS override in inject.css. With the wrapper defaulting to `position: absolute` (R1), `calculatePosition()` runs. This works if the video and wrapper share the same positioned ancestor (likely, since it's only one level up). Added to verification plan.

### R5: Keep the tabpanel rule (ACCEPTED)

Reviewer 2 noted it targets a third-party element and doesn't interfere with this fix. Removing it risks breaking an unknown site for no benefit. Keep it; clean up in a separate PR with testing.

### R6: Add explanatory comment to prevent regression (ACCEPTED)

Future contributors may be tempted to add `position: absolute !important` back. Add a comment in `video-controller.js` explaining the CSS override contract.

### R7: MutationObserver timing is safe (CONFIRMED)

Both reviewers confirmed: `getComputedStyle()` forces synchronous style recalculation, but MutationObservers are microtask-based and won't fire between insertion and the computed style check in the same synchronous JS turn. inject.css is loaded as content script CSS (manifest.json), so it's available before any JS runs.

### R8: Document `calculatePosition()` limitation (ACCEPTED)

`calculatePosition()` computes relative to `video.offsetParent`, but the inner `#controller`'s containing block is the nearest positioned ancestor of the wrapper. These are the same when the wrapper is near the video (true for default insertion and most handlers), but could diverge if a handler inserts far away without a CSS override. This is a pre-existing limitation. The handler `positionOverride` escape hatch (deferred) addresses it.

## Updated Design (incorporating review feedback)

### inject.css base rule (updated)

```css
vsc-controller {
  position: absolute;        /* out of flow; overridden to relative by site rules */
  visibility: visible;
  opacity: 1;
  display: block;
  width: auto !important;    /* keep !important for defense against third-party CSS */
  height: auto !important;   /* keep !important; site overrides use !important too */
  white-space: normal;
  user-select: none;
}
```

### inject.css site overrides for height (updated)

```css
.Shared-Video-player > vsc-controller { height: 0 !important; }
.dv-player-fullscreen vsc-controller { height: 0 !important; }
```

### Post-insertion check (updated)

```js
const isRelative = getComputedStyle(wrapper).position === 'relative';

if (!isRelative) {
  // Wrapper is absolute (CSS default) — compute position for inner controller
  const position = ShadowDOMManager.calculatePosition(this.video);
  innerController.style.top = position.top;
  innerController.style.left = position.left;
}
// else: CSS override set wrapper to relative with a nudge.
// Inner controller stays at (0,0), positioned relative to wrapper. Correct.
```

### Updated verification plan

| Site | Expected behavior | What to check |
|---|---|---|
| YouTube (main) | Controller 10px below top of player | `.ytp-hide-info-bar` CSS override active |
| YouTube (embedded, e.g. igvita.com) | Controller 60px below top (clears title) | `.html5-video-player:not(.ytp-hide-info-bar)` CSS override active |
| Netflix | Controller 85px below top (clears transport) | `#netflix-player` CSS override active |
| Facebook | Controller 40px below top | `#facebook` CSS override active |
| Apple TV+ | Controller at video's top-left corner | `calculatePosition()` path, no CSS override |
| Generic site (e.g. random `<video>`) | Controller at video's top-left corner | `calculatePosition()` path, no CSS override |
| Drag on any site | Controller moves smoothly, stays at new position | Inner `#controller` `top`/`left` updated |
| Amazon Prime Video | No black overlay | `height: 0 !important` rule works |
| OpenAI | No black overlay | `height: 0 !important` rule works |
| ChatGPT | Controller offset 35px left | CSS override with `left: 35px` |
| Google Photos | Controller below player chrome | CSS override active |
| Google Drive | Controller below player chrome | CSS override active |

## Summary of Changes (final)

| File | Change | Risk |
|---|---|---|
| `src/core/video-controller.js` | Remove inline position from wrapper (keep z-index only); reorder to insert-then-position; apply computed position to inner `#controller` with post-insertion CSS check; add explanatory comment | **Core change** — affects all sites. Safe: restores proven pre-refactor architecture with `position: absolute` in CSS instead of inline. |
| `src/styles/inject.css` | Add `position: absolute` to base rule (no `!important`); add `!important` to OpenAI/Amazon `height: 0` rules; remove `!important` from ChatGPT rule; remove Vine rules | **Low risk** — base position change is key enabler; rest is cleanup. |
| `src/ui/shadow-dom.js` | No changes | — |
| Site handlers | No changes | — |
