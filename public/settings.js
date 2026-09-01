/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

export const SETTINGS_MENU_ITEMS = Object.freeze([
  { id: 'playerOptionsBtn', label: 'Player Options', kind: 'submenu' },
  { id: 'cameraBtn', label: 'Camera', kind: 'choice' },
  { id: 'radarZoomBtn', label: 'Radar Range', kind: 'choice' },
  { id: 'mouseBtn', label: 'Mouse Control', kind: 'toggle' },
  { id: 'virtualControlsBtn', label: 'Virtual Controls', kind: 'toggle' },
  { id: 'fullscreenBtn', label: 'Fullscreen', kind: 'toggle' },
  { id: 'installBtn', label: 'Install App', kind: 'action' },
  { id: 'debugBtn', label: 'Debug HUD', kind: 'toggle' },
  { id: 'debugGeometryBtn', label: 'Debug Geometry', kind: 'toggle' },
  { id: 'debugLabelsBtn', label: 'Debug Labels', kind: 'toggle' },
  { id: 'wireframeBtn', label: 'Wireframe', kind: 'toggle' },
  { id: 'dynamicLightingBtn', label: 'Dynamic Lighting', kind: 'toggle' },
  { id: 'anaglyphBtn', label: 'Anaglyph 3D', kind: 'toggle' },
  { id: 'voiceBtn', label: 'Voice Settings', kind: 'submenu' },
  { id: 'helpBtn', label: 'Help', kind: 'submenu' },
  { id: 'operatorBtn', label: 'Operator', kind: 'submenu' },
  { id: 'xrBtn', label: 'VR Mode', kind: 'action' },
  { id: 'closeSettingsHud', label: 'Close', kind: 'action' },
]);

function ensureRowContent(button) {
  let label = button.querySelector('.settingsMenuLabel');
  let value = button.querySelector('.settingsMenuValue');
  if (label && value) return { label, value };

  label = document.createElement('span');
  label.className = 'settingsMenuLabel';
  value = document.createElement('span');
  value.className = 'settingsMenuValue';
  button.replaceChildren(label, value);
  return { label, value };
}

function defaultValue(item) {
  if (item.kind === 'submenu') return 'Open >';
  if (item.id === 'closeSettingsHud') return '';
  if (item.kind === 'action') return 'Activate';
  return '';
}

export function initSettingsMenu({ root, getValue }) {
  if (!root) return null;

  const list = root.querySelector('.settingsMenuList');
  const items = SETTINGS_MENU_ITEMS.map((item) => ({
    ...item,
    button: document.getElementById(item.id),
  })).filter((item) => item.button);

  items.forEach((item) => {
    list?.appendChild(item.button);
    item.button.classList.add('settingsMenuRow');
    item.button.dataset.menuRow = item.id;
    item.button.dataset.menuKind = item.kind;
    item.button.setAttribute('role', 'menuitem');
  });

  const refresh = () => {
    items.forEach((item) => {
      const { label, value } = ensureRowContent(item.button);
      const currentValue = typeof getValue === 'function' ? getValue(item.id, item) : undefined;
      label.textContent = item.label;
      value.textContent = currentValue ?? defaultValue(item);
      // Only On/Off rows carry a state colour. Rows that read "Open >", "Long"
      // or "First Person" are not on or off, so they keep the neutral styling.
      if (value.textContent === 'On' || value.textContent === 'Off') {
        item.button.dataset.menuState = value.textContent.toLowerCase();
      } else {
        delete item.button.dataset.menuState;
      }
      item.button.setAttribute('aria-label', value.textContent ? `${item.label}: ${value.textContent}` : item.label);
    });
  };

  root.addEventListener('click', () => {
    Promise.resolve().then(refresh);
    window.setTimeout(refresh, 150);
  });
  root.addEventListener('menuadjust', (event) => {
    const button = event.target.closest?.('[data-menu-row]');
    if (!button || button.disabled) return;
    if (button.dataset.menuKind !== 'choice' && button.dataset.menuKind !== 'toggle') return;
    button.click();
  });

  refresh();
  return { refresh, items };
}