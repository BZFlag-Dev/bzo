// Toggle debug labels over objects
export function toggleDebugLabels({ debugLabelsEnabled, setDebugLabelsEnabled, updateHudButtons, showMessage }) {
  setDebugLabelsEnabled(!debugLabelsEnabled);
  localStorage.setItem('debugLabelsEnabled', (!debugLabelsEnabled).toString());
  updateHudButtons();
  showMessage(`Debug Labels: ${!debugLabelsEnabled ? 'ON' : 'OFF'}`);
}
// Set button active/inactive and update title
export function setActive(btn, active, activeTitle, inactiveTitle) {
  if (!btn) return;
  if (active) {
    btn.classList.add('active');
    if (activeTitle) btn.title = activeTitle;
  } else {
    btn.classList.remove('active');
    if (inactiveTitle) btn.title = inactiveTitle;
  }
}

// Update HUD button states
export function updateHudButtons({ mouseBtn, mouseControlEnabled, debugBtn, debugEnabled, fullscreenBtn, cameraBtn, cameraMode }) {
  setActive(mouseBtn, mouseControlEnabled, 'Disable Mouse Movement (M)', 'Enable Mouse Movement (M)');
  setActive(debugBtn, debugEnabled, 'Hide Debug HUD (I)', 'Show Debug HUD (I)');
  setActive(fullscreenBtn, document.fullscreenElement, 'Exit Fullscreen (F)', 'Toggle Fullscreen (F)');
  if (cameraBtn) {
    let camTitle = 'Toggle Camera View (C)';
    if (typeof cameraMode !== 'undefined') {
      camTitle = `Camera: ${cameraMode === 'first-person' ? 'First Person' : cameraMode === 'third-person' ? 'Third Person' : 'Overview'} (C)`;
    }
    cameraBtn.title = camTitle;
  }
}

// Toggle debug HUD
export function toggleDebugHud({ debugEnabled, setDebugEnabled, updateHudButtons, showMessage, updateDebugDisplay, getDebugState }) {
  setDebugEnabled(!debugEnabled);
  localStorage.setItem('debugEnabled', (!debugEnabled).toString());
  const debugHud = document.getElementById('debugHud');
  if (debugHud) debugHud.style.display = !debugEnabled ? 'block' : 'none';
  if (!debugEnabled && !window.debugUpdateInterval) {
    window.debugUpdateInterval = setInterval(() => updateDebugDisplay(getDebugState()), 500);
  } else if (debugEnabled && window.debugUpdateInterval) {
    clearInterval(window.debugUpdateInterval);
    window.debugUpdateInterval = null;
  }
  updateHudButtons();
  showMessage(`Debug Mode: ${!debugEnabled ? 'ON' : 'OFF'}`);
}

// Toggle settings HUD
export function toggleSettingsHud({ settingsHud, settingsBtn, showMessage, updateSettingsBtn }) {
  if (!settingsHud) return;
  if (settingsHud.style.display === 'block') {
    settingsHud.style.display = 'none';
    showMessage('Settings: Hidden');
  } else {
    settingsHud.style.display = 'block';
    showMessage('Settings: Shown');
  }
  updateSettingsBtn();
}

// Toggle help panel
export function toggleHelpPanel({ helpPanel, helpBtn, showMessage, updateHelpBtn }) {
  if (!helpPanel) return;
  if (helpPanel.style.display === 'block') {
    helpPanel.style.display = 'none';
    showMessage('Help Panel: Hidden');
  } else {
    helpPanel.style.display = 'block';
    showMessage('Help Panel: Shown');
  }
  updateHelpBtn();
}
/*
 * This file is part of a project licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * See the LICENSE file in the project root or visit https://www.gnu.org/licenses/agpl-3.0.html
 */

// hud.js - Handles HUD and debug display logic

// Updates the debug HUD with current stats
export function updateDebugDisplay({
  fps,
  latency,
  packetsSent,
  packetsReceived,
  sentBps,
  receivedBps,
  playerX,
  playerY,
  playerZ,
  playerRotation,
  myTank,
  cameraMode,
  OBSTACLES,
  clouds,
  latestOrientation
}) {
  const debugContent = document.getElementById('debugContent');
  if (!debugContent) return;

  let html = '<div style="margin-bottom: 10px; font-weight: bold;">PLAYER STATUS:</div>';
  html += `<div><span class="label">FPS:</span><span class="value">${fps?.toFixed(1) ?? ''}</span></div>`;
  html += `<div><span class=\"label\">Bytes Sent/s:</span><span class=\"value\">${sentBps ?? ''}</span></div>`;
  html += `<div><span class=\"label\">Bytes Recv/s:</span><span class=\"value\">${receivedBps ?? ''}</span></div>`;
  if (typeof latency !== 'undefined') {
    html += `<div><span class="label">Ping:</span><span class="value">${Math.round(latency)} ms</span></div>`;
  }
  if (myTank && myTank.userData) {
    html += `<div><span class="label">Speed:</span><span class="value">${myTank.userData.forwardSpeed?.toFixed(2) ?? '0'} u/s</span></div>`;
    html += `<div><span class="label">Angular:</span><span class="value">${myTank.userData.rotationSpeed?.toFixed(2) ?? '0'} rad/s</span></div>`;
    if (myTank.userData.verticalSpeed !== undefined) {
      html += `<div><span class="label">Vertical:</span><span class="value">${myTank.userData.verticalSpeed.toFixed(2)} u/s</span></div>`;
    }
    html += `<div><span class="label">Position:</span><span class="value">(${playerX?.toFixed(1) ?? ''}, ${playerY?.toFixed(1) ?? ''}, ${playerZ?.toFixed(1) ?? ''})</span></div>`;
    html += `<div><span class="label">Rotation:</span><span class="value">${playerRotation?.toFixed(2) ?? ''} rad</span></div>`;
  }
  html += `<div><span class="label">Camera:</span><span class="value">${cameraMode ?? ''}</span></div>`;
  html += `<div><span class="label">Obstacles:</span><span class="value">${OBSTACLES?.length ?? ''}</span></div>`;
  html += `<div><span class="label">Clouds:</span><span class="value">${clouds?.length ?? ''}</span></div>`;
  if (latestOrientation && latestOrientation.status) {
    html += `<div><span class="label">Orientation Status:</span><span class="value">${latestOrientation.status}</span></div>`;
    if (latestOrientation.alpha !== null && latestOrientation.beta !== null && latestOrientation.gamma !== null) {
      html += `<div><span class="label">Orientation α:</span><span class="value">${latestOrientation.alpha.toFixed(1)}</span></div>`;
      html += `<div><span class="label">Orientation β:</span><span class="value">${latestOrientation.beta.toFixed(1)}</span></div>`;
      html += `<div><span class="label">Orientation γ:</span><span class="value">${latestOrientation.gamma.toFixed(1)}</span></div>`;
    }
  }
  // Packets sent/received
  if (packetsSent) {
    html += '<div style="margin: 10px 0; border-top: 1px solid #444; padding-top: 10px; font-weight: bold;">PACKETS SENT:</div>';
    const sentTypes = Array.from(packetsSent.entries()).sort((a, b) => b[1] - a[1]);
    sentTypes.forEach(([type, count]) => {
      html += `<div><span class="label">${type}:</span><span class="value">${count}</span></div>`;
    });
  }
  if (packetsReceived) {
    html += '<div style="margin: 10px 0; border-top: 1px solid #444; padding-top: 10px; font-weight: bold;">PACKETS RECEIVED:</div>';
    const receivedTypes = Array.from(packetsReceived.entries()).sort((a, b) => b[1] - a[1]);
    receivedTypes.forEach(([type, count]) => {
      html += `<div><span class="label">${type}:</span><span class="value">${count}</span></div>`;
    });
  }
  debugContent.innerHTML = html;
}

// Add more HUD-related exports as needed (scoreboard, chat, etc.)
