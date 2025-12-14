/*
 * This file is part of a project licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * See the LICENSE file in the project root or visit https://www.gnu.org/licenses/agpl-3.0.html
 */

// hud.js - Handles HUD and debug display logic

// Converts a color int or string to a CSS color string
export function colorToCSS(color) {
  if (typeof color === 'string') return color;
  if (typeof color === 'number') return `#${color.toString(16).padStart(6, '0')}`;
  if (color && typeof color.getHexString === 'function') return `#${color.getHexString()}`;
  return '#888';
}

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
  latestOrientation,
  worldTime
}) {
  const debugContent = document.getElementById('debugContent');
  if (!debugContent) return;

  let html = '<div style="margin-bottom: 10px; font-weight: bold;">PLAYER STATUS:</div>';
  if (typeof latency !== 'undefined') {
    html += `<div><span class="label">FPS/Ping:</span><span class="value">${fps?.toFixed(1) ?? ''}/${Math.round(latency)} ms</span></div>`;
  }
  html += `<div><span class=\"label\">Bytes Sent/Recv/s:</span><span class=\"value\">${sentBps ?? ''}/${receivedBps ?? ''}</span></div>`;
  if (myTank && myTank.userData) {
    html += `<div><span class="label">Linear/Angular:</span><span class="value">${myTank.userData.forwardSpeed?.toFixed(2) ?? '0'}u/${myTank.userData.rotationSpeed?.toFixed(2) ?? '0'}rad</span></div>`;
    if (myTank.userData.verticalSpeed !== undefined) {
      html += `<div><span class="label">Vertical:</span><span class="value">${myTank.userData.verticalSpeed.toFixed(2)} u/s</span></div>`;
    }
    html += `<div><span class="label">Position:</span><span class="value">(${playerX?.toFixed(1) ?? ''}, ${playerY?.toFixed(1) ?? ''}, ${playerZ?.toFixed(1) ?? ''})</span></div>`;
    html += `<div><span class="label">Rotation:</span><span class="value">${playerRotation?.toFixed(2) ?? ''} rad</span></div>`;
  }
  html += `<div><span class="label">Camera:</span><span class="value">${cameraMode ?? ''}</span></div>`;
  html += `<div><span class="label">Obs/Clouds:</span><span class="value">${OBSTACLES?.length ?? ''}/${clouds?.length ?? ''}</span></div>`;
  if (typeof worldTime !== 'undefined') {
    html += `<div><span class="label">World Time:</span><span class="value">${worldTime.toFixed(1)} (${formatWorldTime(worldTime)})</span></div>`;
  }
  
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

  // Helper to format world time as HH:MM
  function formatWorldTime(worldTime) {
    if (typeof worldTime !== 'number') return '';
    // Minecraft: 0 = 6:00, 6000 = noon, 12000 = 18:00, 18000 = midnight
    let ticks = worldTime % 24000;
    let totalMinutes = Math.floor((ticks / 1000) * 60); // 1000 ticks = 1 hour
    let hours = Math.floor(totalMinutes / 60) + 6; // 0 ticks = 6:00
    if (hours >= 24) hours -= 24;
    let minutes = totalMinutes % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }
}

// Updates the scoreboard with current player stats
export function updateScoreboard({
  myPlayerId,
  myPlayerName,
  myTank,
  tanks
}) {
  const scoreboardList = document.getElementById('scoreboardList');
  if (!scoreboardList) return;
  scoreboardList.innerHTML = '';
  // Fix: declare playerData array
  const playerData = [];

  // Collect all player data
    // Align degreeBar bottom exactly to controlBox top (avoid rounding gap)
    degreeBar.style.top = (controlBox.getBoundingClientRect().top - degreeBar.height + 1) + 'px';

  // Add current player
  if (myPlayerId && myTank && myTank.userData.playerState) {
    playerData.push({
      id: myPlayerId,
      name: myPlayerName,
      kills: myTank.userData.playerState.kills || 0,
      deaths: myTank.userData.playerState.deaths || 0,
      connectDate: myTank.userData.playerState.connectDate ? new Date(myTank.userData.playerState.connectDate) : new Date(0),
      color: myTank.userData.playerState.color,
      isCurrent: true
    });
  }

  // Add other players from server state
  tanks.forEach((tank, id) => {
    if (id !== myPlayerId && tank.userData.playerState) {
      playerData.push({
        id: id,
        name: tank.userData.playerState.name || 'Player',
        kills: tank.userData.playerState.kills || 0,
        deaths: tank.userData.playerState.deaths || 0,
        connectDate: tank.userData.playerState.connectDate ? new Date(tank.userData.playerState.connectDate) : new Date(0),
        color: tank.userData.playerState.color,
        isCurrent: false
      });
    }
  });

  // Sort by (kills - deaths) descending, then kills descending, then deaths ascending, then connectDate ascending (oldest first)
  playerData.sort((a, b) => {
    const aScore = (a.kills || 0) - (a.deaths || 0);
    const bScore = (b.kills || 0) - (b.deaths || 0);
    if (bScore !== aScore) return bScore - aScore;
    if ((b.kills || 0) !== (a.kills || 0)) return b.kills - a.kills;
    if ((a.deaths || 0) !== (b.deaths || 0)) return (a.deaths || 0) - (b.deaths || 0);
    return a.connectDate - b.connectDate;
  });

  // Create scoreboard entries
  playerData.forEach(player => {
    const entry = document.createElement('div');
    entry.className = 'scoreboardEntry' + (player.isCurrent ? ' current' : '');
    if (player.color) {
      entry.style.color = colorToCSS(player.color);
    }
    const nameSpan = document.createElement('span');
    nameSpan.className = 'scoreboardName';
    nameSpan.textContent = player.name;

    const statsSpan = document.createElement('span');
    statsSpan.className = 'scoreboardStats';
    statsSpan.textContent = `${player.kills} / ${player.deaths}`;

    entry.appendChild(nameSpan);
    entry.appendChild(statsSpan);
    scoreboardList.appendChild(entry);
  });
}

// Draws a degree bar above the control box
export function updateDegreeBar({ myTank, playerRotation }) {
  const degreeBar = document.getElementById('degreeBar');
  const controlBox = document.getElementById('controlBox');
  if (!degreeBar || !controlBox || !myTank) return;
  // Responsive: let CSS control size, set canvas size for HiDPI
  const barRect = degreeBar.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  degreeBar.width = Math.round(barRect.width * dpr);
  degreeBar.height = Math.round(barRect.height * dpr);
  // Align bottom of degreeBar to top of controlBox
  degreeBar.style.top = (controlBox.getBoundingClientRect().top - barRect.height + 1) + 'px';
  // Optionally, align left if needed: degreeBar.style.left = ...
  const ctx = degreeBar.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale for HiDPI
  ctx.clearRect(0, 0, barRect.width, barRect.height);

  // Get controlBox border color for bar/labels
  let barColor = '#4CAF50';
  let labelColor = '#4CAF50';
  if (controlBox) {
    const style = window.getComputedStyle(controlBox);
    const borderColor = style.borderColor;
    barColor = borderColor;
    labelColor = borderColor;
    if (controlBox.classList.contains('keyboard-mode')) {
      barColor = 'rgba(255, 152, 0, 0.6)';
      labelColor = 'rgba(255, 152, 0, 0.9)';
    }
  }

  // Bar spans 45 degrees, centered on playerRotation (in radians)
  const degSpan = 45;
  const centerDeg = ((playerRotation || 0) * 180 / Math.PI) % 360;
  // Reverse direction: as player turns right, bar moves left
  const startDeg = centerDeg + degSpan / 2;
  const endDeg = centerDeg - degSpan / 2;
  const pxPerDeg = barRect.width / degSpan;

  ctx.save();
  ctx.strokeStyle = barColor;
  ctx.lineWidth = 2;
  ctx.font = '13px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Draw ticks and labels for every 5 degrees in the visible span
  // Ticks connect to controlBox top edge responsively
  const barBottom = barRect.height - 4;
  for (let deg = Math.ceil(startDeg / 5) * 5; deg >= endDeg; deg -= 5) {
    let normDeg = ((deg % 360) + 360) % 360;
    const px = (startDeg - deg) * pxPerDeg;
    const isMajor = normDeg % 10 === 0;
    // Shorter ticks, like altimeter
    const y1 = barBottom;
    const y2 = isMajor ? barBottom - barRect.height * 0.45 : barBottom - barRect.height * 0.35;
    ctx.beginPath();
    ctx.moveTo(px, y1);
    ctx.lineTo(px, y2);
    ctx.stroke();
    if (isMajor) {
      ctx.fillStyle = labelColor;
      // Place number above the tick
      ctx.textBaseline = 'bottom';
      ctx.fillText(normDeg.toFixed(0), px, y2 - 2);
      ctx.textBaseline = 'top'; // restore for safety
    }
  }
  ctx.restore();
}

// Draws on the right side of the control box
export function updateAltimeter({ myTank, tickSpacing = 5 }) {
  const altimeter = document.getElementById('altimeter');
  if (!altimeter || !myTank) return;
  const ctx = altimeter.getContext('2d');
  // Responsive: let CSS control size, set canvas size for HiDPI
  const controlBox = document.getElementById('controlBox');
  const boxRect = controlBox ? controlBox.getBoundingClientRect() : null;
  const altRect = altimeter.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  altimeter.width = Math.round(altRect.width * dpr);
  altimeter.height = Math.round(altRect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale for HiDPI
  // Clear the canvas to transparent (no background fill)
  ctx.clearRect(0, 0, altRect.width, altRect.height);
  // Do not fill any background; keep fully transparent

  // Show 30 units from top to bottom
  const unitsVisible = 30;
  const pixelsPerUnit = altRect.height / unitsVisible;
  const tankY = myTank.position.y;
  const centerY = altRect.height / 2;

  // Get controlBox border color for altimeter lines/numbers
  let tickColor = '#4CAF50'; // fallback to green
  let numberColor = '#4CAF50';
  if (controlBox) {
    const style = window.getComputedStyle(controlBox);
    const borderColor = style.borderColor;
    tickColor = borderColor;
    numberColor = borderColor;
    if (controlBox.classList.contains('keyboard-mode')) {
      tickColor = 'rgba(255, 152, 0, 0.6)';
      numberColor = 'rgba(255, 152, 0, 0.9)';
    }
  }

  // Draw ticks and numbers relative to tankY at center, with smooth scrolling
  ctx.save();
  ctx.strokeStyle = tickColor;
  ctx.lineWidth = 2;
  ctx.font = '12px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  // Ticks start at the left edge of the altimeter, which should abut the controlBox
  let tickStart = 0;
  let tickEnd = Math.max(8, altRect.width * 0.28); // short, responsive
  let numberOffset = tickEnd + 4;
  // If controlBox is present, align tickStart to the edge closest to controlBox
  if (boxRect && altRect) {
    // If altimeter is to the right of controlBox, align left edge
    if (altRect.left > boxRect.right - 5) {
      tickStart = 0;
    } else if (altRect.right < boxRect.left + 5) {
      // If altimeter is to the left, align right edge
      tickStart = altRect.width;
      tickEnd = altRect.width - Math.max(8, altRect.width * 0.28);
      numberOffset = tickEnd - 4;
    }
  }

  // Find the first tick below the current Y (may be fractional)
  const firstTick = Math.floor((tankY - unitsVisible / 2) / tickSpacing) * tickSpacing;
  const lastTick = Math.ceil((tankY + unitsVisible / 2) / tickSpacing) * tickSpacing;

  for (let alt = firstTick; alt <= lastTick; alt += tickSpacing) {
    if (alt < 0) continue;
    // Compute y position with smooth scrolling
    const y = centerY - (alt - tankY) * pixelsPerUnit;
    ctx.beginPath();
    ctx.moveTo(tickStart, y);
    ctx.lineTo(tickEnd, y);
    ctx.stroke();
    if ((alt / tickSpacing) % 2 === 0) {
      ctx.fillStyle = numberColor;
      ctx.fillText(alt.toString(), numberOffset, y);
    }
  }
  ctx.restore();

  // Draw current altitude indicator (shorter center line)
  ctx.save();
  ctx.strokeStyle = '#ff0';
  ctx.lineWidth = 3;
  // Make the yellow line even shorter than the tick lines
  const centerLineStart = 0;
  const centerLineEnd = altRect.width * 0.22; // shorter than tickEnd
  ctx.beginPath();
  ctx.moveTo(centerLineStart, centerY);
  ctx.lineTo(centerLineEnd, centerY);
  ctx.stroke();
  ctx.restore();
}
