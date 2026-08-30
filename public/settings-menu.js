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
  { id: 'debugBtn', label: 'Debug HUD', kind: 'toggle' },
  { id: 'debugGeometryBtn', label: 'Debug Geometry', kind: 'toggle' },
  { id: 'debugLabelsBtn', label: 'Debug Labels', kind: 'toggle' },
  { id: 'wireframeBtn', label: 'Wireframe', kind: 'toggle' },
  { id: 'dynamicLightingBtn', label: 'Dynamic Lighting', kind: 'toggle' },
  { id: 'anaglyphBtn', label: 'Anaglyph 3D', kind: 'toggle' },
  { id: 'graphicsQualitySelect', rowId: 'graphicsQualityRow', label: 'Graphics Quality', kind: 'select' },
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
  const items = SETTINGS_MENU_ITEMS.map((item) => ({ ...item, ...getItemElements(item) }))
    .filter((item) => item.control && item.row);

  items.forEach((item) => {
    list?.appendChild(item.row);
    item.row.classList.add('settingsMenuRow');
    item.control.dataset.menuRow = item.id;
    item.control.dataset.menuKind = item.kind;
  });

  const refresh = () => {
    items.forEach((item) => {
      const currentValue = typeof getValue === 'function' ? getValue(item.id, item) : undefined;
      if (item.kind === 'select') {
        const label = item.row.querySelector(`label[for="${item.id}"]`);
        if (label) label.textContent = item.label;
        const value = (currentValue ?? item.control.selectedOptions[0]?.textContent) || '';
        item.control.setAttribute('aria-label', value ? `${item.label}: ${value}` : item.label);
        return;
      }

      const { label, value } = ensureRowContent(item.control);
      label.textContent = item.label;
      value.textContent = currentValue ?? defaultValue(item);
      item.control.setAttribute('aria-label', value.textContent ? `${item.label}: ${value.textContent}` : item.label);
    });
  };

  const activate = (item, direction = 1) => {
    if (!item || item.control.disabled) return false;
    if (item.kind === 'select') return selectRelativeOption(item.control, direction);
    item.control.click();
    return true;
  };

  root.addEventListener('click', () => {
    Promise.resolve().then(refresh);
    window.setTimeout(refresh, 150);
  });
  root.addEventListener('change', (event) => {
    const item = items.find((candidate) => candidate.control === event.target);
    if (!item || item.kind !== 'select') return;
    refresh();
    root.dispatchEvent(new window.CustomEvent('graphicsqualitychange', {
      bubbles: true,
      detail: { value: item.control.value },
    }));
  });
  root.addEventListener('menuadjust', (event) => {
    const control = event.target.closest?.('[data-menu-row]');
    if (!control || control.disabled) return;
    const item = items.find((candidate) => candidate.control === control);
    if (!item) return;
    if (item.kind === 'select') {
      selectRelativeOption(item.control, Number(event.detail?.direction) < 0 ? -1 : 1);
      return;
    }
    if (item.kind !== 'choice' && item.kind !== 'toggle') return;
    item.control.click();
  });

  refresh();
  return { refresh, items, activate };
}

function getItemElements(item) {
  const control = document.getElementById(item.id);
  const row = document.getElementById(item.rowId || item.id);
  return { control, row };
}

function selectRelativeOption(select, direction) {
  const options = Array.from(select.options).filter((option) => !option.disabled);
  if (!options.length) return false;

  const currentIndex = Math.max(options.indexOf(select.selectedOptions[0]), 0);
  const nextIndex = (currentIndex + direction + options.length) % options.length;
  select.value = options[nextIndex].value;
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  return true;
}
