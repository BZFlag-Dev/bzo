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
