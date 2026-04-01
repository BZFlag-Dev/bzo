/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/BZFlag-Dev/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

// hud.js - Handles HUD and debug display logic

const degreeBarRenderState = {
  canvas: null,
  controlBox: null,
  width: 0,
  height: 0,
  dpr: 0,
  topPx: null,
  centerDegKey: null,
  colorKey: ''
};

const altimeterRenderState = {
  canvas: null,
  controlBox: null,
  width: 0,
  height: 0,
  dpr: 0,
  tankYKey: null,
  colorKey: ''
};

const shotStatusRenderState = {
  canvas: null,
  controlBox: null,
  width: 0,
  height: 0,
  dpr: 0,
  topPx: null,
  leftPx: null,
  stateKey: '',
  colorKey: ''
};

function getHudCanvasContext(cache, canvasId, controlBoxId = 'controlBox') {
  if (!cache.canvas) {
    cache.canvas = document.getElementById(canvasId);
  }
  if (!cache.controlBox) {
    cache.controlBox = document.getElementById(controlBoxId);
  }
  if (!cache.canvas) {
    return null;
  }
  return {
    canvas: cache.canvas,
    controlBox: cache.controlBox,
    ctx: cache.canvas.getContext('2d')
  };
}

function resizeHudCanvasIfNeeded(cache, canvas, width, height, dpr) {
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  const resized = cache.width !== width || cache.height !== height || cache.dpr !== dpr ||
    canvas.width !== pixelWidth || canvas.height !== pixelHeight;
  if (resized) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    cache.width = width;
    cache.height = height;
    cache.dpr = dpr;
  }
  return resized;
}

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
export function toggleSettingsHud({ settingsHud, showMessage, updateSettingsBtn }) {
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
export function toggleHelpPanel({ helpPanel, showMessage, updateHelpBtn }) {
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

// Formats world time (0-23999 ticks) as HH:MM. Minecraft: 0 = 6:00, 6000 = noon.
function formatWorldTime(worldTime) {
  if (typeof worldTime !== 'number') return '';
  const ticks = worldTime % 24000;
  const totalMinutes = Math.floor((ticks / 1000) * 60); // 1000 ticks = 1 hour
  let hours = Math.floor(totalMinutes / 60) + 6; // 0 ticks = 6:00
  if (hours >= 24) hours -= 24;
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
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
  worldTime,
  gamepadConnected,
  gamepadInfo
}) {
  const debugContent = document.getElementById('debugContent');
  if (!debugContent) return;

  let html = '<div style="margin-bottom: 10px; font-weight: bold;">PLAYER STATUS:</div>';
  if (typeof latency !== 'undefined') {
    html += `<div><span class="label">FPS/Ping:</span><span class="value">${fps?.toFixed(1) ?? ''}/${Math.round(latency)} ms</span></div>`;
  }
  html += `<div><span class="label">Bytes Sent/Recv/s:</span><span class="value">${sentBps ?? ''}/${receivedBps ?? ''}</span></div>`;
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

  // Gamepad info
  if (gamepadConnected && gamepadInfo) {
    html += `<div><span class="label">Gamepad:</span><span class="value">Connected</span></div>`;
    html += `<div><span class="label">Gamepad ID:</span><span class="value">${gamepadInfo.id.substring(0, 30)}...</span></div>`;
    html += `<div><span class="label">Mapping:</span><span class="value">${gamepadInfo.mapping || 'unknown'}</span></div>`;
    html += `<div><span class="label">Buttons/Axes:</span><span class="value">${gamepadInfo.buttons}/${gamepadInfo.axes}</span></div>`;
  } else {
    html += `<div><span class="label">Gamepad:</span><span class="value">Not connected</span></div>`;
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
  const playerData = [];

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
  const hud = getHudCanvasContext(degreeBarRenderState, 'degreeBar');
  if (!hud || !hud.controlBox || !myTank) return;
  const { canvas: degreeBar, controlBox, ctx } = hud;
  const barRect = degreeBar.getBoundingClientRect();
  const barWidth = Math.round(barRect.width);
  const barHeight = Math.round(barRect.height);
  if (!barWidth || !barHeight) return;
  const dpr = window.devicePixelRatio || 1;
  const resized = resizeHudCanvasIfNeeded(degreeBarRenderState, degreeBar, barWidth, barHeight, dpr);
  // Align bottom of degreeBar to top of controlBox
  const topPx = Math.round(controlBox.getBoundingClientRect().top - barHeight + 1);
  if (degreeBarRenderState.topPx !== topPx) {
    degreeBar.style.top = `${topPx}px`;
    degreeBarRenderState.topPx = topPx;
  }

  // Get controlBox border color for bar/labels
  let barColor = '#4CAF50';
  let labelColor = '#4CAF50';
  const style = window.getComputedStyle(controlBox);
  const borderColor = style.borderColor;
  barColor = borderColor;
  labelColor = borderColor;
  if (controlBox.classList.contains('keyboard-mode')) {
    barColor = 'rgba(255, 152, 0, 0.6)';
    labelColor = 'rgba(255, 152, 0, 0.9)';
  }

  // Bar spans 45 degrees, centered on playerRotation (in radians)
  const degSpan = 45;
  const centerDeg = ((playerRotation || 0) * 180 / Math.PI) % 360;
  const pxPerDeg = barWidth / degSpan;
  const centerDegKey = Math.round(centerDeg * pxPerDeg * 2) / 2;
  const colorKey = `${barColor}|${labelColor}|${controlBox.classList.contains('keyboard-mode')}`;
  if (!resized && degreeBarRenderState.centerDegKey === centerDegKey && degreeBarRenderState.colorKey === colorKey) {
    return;
  }
  degreeBarRenderState.centerDegKey = centerDegKey;
  degreeBarRenderState.colorKey = colorKey;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale for HiDPI
  ctx.clearRect(0, 0, barWidth, barHeight);

  // Reverse direction: as player turns right, bar moves left
  const startDeg = centerDeg + degSpan / 2;
  const endDeg = centerDeg - degSpan / 2;

  ctx.save();
  ctx.strokeStyle = barColor;
  ctx.lineWidth = 2;
  ctx.font = '13px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Draw ticks and labels for every 5 degrees in the visible span
  // Ticks connect to controlBox top edge responsively
  const barBottom = barHeight - 4;
  for (let deg = Math.ceil(startDeg / 5) * 5; deg >= endDeg; deg -= 5) {
    let normDeg = ((deg % 360) + 360) % 360;
    const px = (startDeg - deg) * pxPerDeg;
    const isMajor = normDeg % 10 === 0;
    // Shorter ticks, like altimeter
    const y1 = barBottom;
    const y2 = isMajor ? barBottom - barHeight * 0.45 : barBottom - barHeight * 0.35;
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
  const hud = getHudCanvasContext(altimeterRenderState, 'altimeter');
  if (!hud || !myTank) return;
  const { canvas: altimeter, controlBox, ctx } = hud;
  const altRect = altimeter.getBoundingClientRect();
  const altWidth = Math.round(altRect.width);
  const altHeight = Math.round(altRect.height);
  if (!altWidth || !altHeight) return;
  const boxRect = controlBox ? controlBox.getBoundingClientRect() : null;
  const dpr = window.devicePixelRatio || 1;
  const resized = resizeHudCanvasIfNeeded(altimeterRenderState, altimeter, altWidth, altHeight, dpr);

  // Show 30 units from top to bottom
  const unitsVisible = 30;
  const pixelsPerUnit = altHeight / unitsVisible;
  const tankY = myTank.position.y;
  const centerY = altHeight / 2;

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
  const tankYKey = Math.round(tankY * pixelsPerUnit * 2) / 2;
  const colorKey = `${tickColor}|${numberColor}|${controlBox?.classList.contains('keyboard-mode') ?? false}`;
  if (!resized && altimeterRenderState.tankYKey === tankYKey && altimeterRenderState.colorKey === colorKey) {
    return;
  }
  altimeterRenderState.tankYKey = tankYKey;
  altimeterRenderState.colorKey = colorKey;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale for HiDPI
  ctx.clearRect(0, 0, altWidth, altHeight);

  // Draw ticks and numbers relative to tankY at center, with smooth scrolling
  ctx.save();
  ctx.strokeStyle = tickColor;
  ctx.lineWidth = 2;
  ctx.font = '12px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  // Ticks start at the left edge of the altimeter, which should abut the controlBox
  let tickStart = 0;
  let tickEnd = Math.max(8, altWidth * 0.28); // short, responsive
  let numberOffset = tickEnd + 4;
  // If controlBox is present, align tickStart to the edge closest to controlBox
  if (boxRect && altRect) {
    // If altimeter is to the right of controlBox, align left edge
    if (altRect.left > boxRect.right - 5) {
      tickStart = 0;
    } else if (altRect.right < boxRect.left + 5) {
      // If altimeter is to the left, align right edge
      tickStart = altWidth;
      tickEnd = altWidth - Math.max(8, altWidth * 0.28);
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
  const centerLineEnd = altWidth * 0.22; // shorter than tickEnd
  ctx.beginPath();
  ctx.moveTo(centerLineStart, centerY);
  ctx.lineTo(centerLineEnd, centerY);
  ctx.stroke();
  ctx.restore();
}

export function updateShotStatus({ myPlayerId, projectiles, gameConfig, now = Date.now() }) {
  const hud = getHudCanvasContext(shotStatusRenderState, 'shotStatus');
  if (!hud || !myPlayerId || !gameConfig) return;
  const { canvas: shotStatus, controlBox, ctx } = hud;
  const maxSlots = Math.max(1, Math.floor(gameConfig.SHOT_MAX_ACTIVE || 1));
  const indicatorWidth = Math.max(18, Math.round(window.innerWidth / 50));
  const indicatorHeight = Math.max(8, Math.round(window.innerHeight / 80));
  const indicatorSpace = Math.max(2, Math.round(indicatorHeight / 10) + 2);
  const totalHeight = (indicatorHeight * maxSlots) + (indicatorSpace * Math.max(0, maxSlots - 1));
  if (shotStatus.style.width !== `${indicatorWidth}px`) {
    shotStatus.style.width = `${indicatorWidth}px`;
  }
  if (shotStatus.style.height !== `${totalHeight}px`) {
    shotStatus.style.height = `${totalHeight}px`;
  }
  const statusRect = shotStatus.getBoundingClientRect();
  const statusWidth = Math.round(statusRect.width);
  const statusHeight = Math.round(statusRect.height);
  if (!statusWidth || !statusHeight) return;
  const dpr = window.devicePixelRatio || 1;
  const resized = resizeHudCanvasIfNeeded(shotStatusRenderState, shotStatus, statusWidth, statusHeight, dpr);
  const boxRect = controlBox?.getBoundingClientRect();
  if (boxRect) {
    const topPx = Math.round(boxRect.top + ((boxRect.height - totalHeight) / 2));
    const leftPx = Math.round(boxRect.right + indicatorWidth + 16);
    if (shotStatusRenderState.topPx !== topPx) {
      shotStatus.style.top = `${topPx}px`;
      shotStatusRenderState.topPx = topPx;
    }
    if (shotStatusRenderState.leftPx !== leftPx) {
      shotStatus.style.left = `${leftPx}px`;
      shotStatusRenderState.leftPx = leftPx;
    }
  }

  const shotSpeed = Number.isFinite(gameConfig.SHOT_SPEED) ? gameConfig.SHOT_SPEED : 100;
  const shotRange = Number.isFinite(gameConfig.SHOT_RANGE)
    ? gameConfig.SHOT_RANGE
    : (Number.isFinite(gameConfig.SHOT_DISTANCE) ? gameConfig.SHOT_DISTANCE : 350);
  const slotLifetimeMs = shotSpeed > 0 ? (shotRange / shotSpeed) * 1000 : 0;
  const slotProgress = new Array(maxSlots).fill(1);
  if (projectiles && typeof projectiles.forEach === 'function') {
    projectiles.forEach((projectile) => {
      if (projectile?.userData?.playerId !== myPlayerId) return;
      const slotIndex = Number.isInteger(projectile?.userData?.shotSlot) ? projectile.userData.shotSlot : -1;
      if (slotIndex < 0 || slotIndex >= maxSlots) return;
      const createdAt = Number.isFinite(projectile?.userData?.createdAt) ? projectile.userData.createdAt : now;
      const ageMs = Math.max(0, now - createdAt);
      const progress = slotLifetimeMs > 0 ? Math.max(0, Math.min(1, ageMs / slotLifetimeMs)) : 0;
      slotProgress[slotIndex] = progress;
    });
  }

  const stateKey = `${maxSlots}:${slotProgress.map((value) => value.toFixed(2)).join('|')}`;
  const colorKey = 'bzflag-shot-slots';
  if (!resized && shotStatusRenderState.stateKey === stateKey && shotStatusRenderState.colorKey === colorKey) {
    return;
  }
  shotStatusRenderState.stateKey = stateKey;
  shotStatusRenderState.colorKey = colorKey;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, statusWidth, statusHeight);

  const slotHeight = indicatorHeight;
  const slotWidth = indicatorWidth;
  const readyColor = 'rgba(255, 255, 255, 0.5)';
  const reloadBaseColor = 'rgba(255, 0, 0, 0.5)';
  const reloadFillColor = 'rgba(0, 255, 0, 0.5)';

  ctx.save();
  for (let i = 0; i < maxSlots; i++) {
    const x = 0;
    const y = i * (slotHeight + indicatorSpace);
    const progress = slotProgress[i];
    const available = progress >= 1;

    if (available) {
      ctx.fillStyle = readyColor;
      ctx.fillRect(x, y, slotWidth, slotHeight);
    } else {
      ctx.fillStyle = reloadBaseColor;
      ctx.fillRect(x, y, slotWidth, slotHeight);
      ctx.fillStyle = reloadFillColor;
      ctx.fillRect(x, y, slotWidth * progress, slotHeight);
    }
  }
  ctx.restore();
}
