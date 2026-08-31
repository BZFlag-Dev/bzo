/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

// install.js - Offers installing the game as an app from the Settings menu.
//
// Chromium fires `beforeinstallprompt` only when a page is installable and not
// already installed, so the event is itself the availability test: there is no
// API that answers "is this site installed" from inside a browser tab. Safari
// and Firefox never fire it and have no programmatic install, so the row reads
// Unavailable there and the player uses the browser's own menu.

let deferredPrompt = null;
let installButton = null;
let onStateChange = null;

// Chromium withholds the event until it decides the page qualifies, so listen
// before anything else runs rather than waiting for the Settings menu to open.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  refreshInstallButton();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  refreshInstallButton();
});

// An installed launch runs in its own window rather than a browser tab. The XR
// session also reports fullscreen, which is harmless: either way the player is
// past needing an install row.
function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: minimal-ui)').matches
    || window.navigator.standalone === true;
}

function installState() {
  if (isInstalled()) return 'installed';
  return deferredPrompt ? 'available' : 'unavailable';
}

function refreshInstallButton() {
  if (!installButton) return;
  const state = installState();
  installButton.dataset.installState = state;
  installButton.disabled = state !== 'available';
  onStateChange?.();
}

export function setupInstallPrompt(button, notifyStateChange) {
  installButton = button;
  onStateChange = notifyStateChange;
  if (!installButton) return;
  installButton.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!deferredPrompt) return;
    const prompt = deferredPrompt;
    // A prompt can only be shown once, so drop it whichever way the player answers.
    deferredPrompt = null;
    await prompt.prompt();
    refreshInstallButton();
  });
  refreshInstallButton();
}
