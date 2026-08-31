/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

// Labels for a server, derived only from the host the client asked for, so a
// tab, a bookmark, a home screen icon and a launcher entry all name it the same
// way and two servers never look alike.

// Launchers truncate long app labels themselves, and their limits vary by
// platform, launcher and font size. Truncation is graceful -- a clipped hostname
// still reads as the right server -- so shorten only when a label is long enough
// that the platform's own cut would leave several servers looking identical.
const SHORT_NAME_MAX = 24;

const PRODUCT_NAME = 'Battlezone Online';

// The Host header is client-supplied and reaches the page title, so reduce it to
// the characters a host can legitimately contain: DNS labels, an IPv6 literal in
// brackets, and a port. An IDN arrives already punycoded by the browser
// (`xn--mnchen-3ya.example.com`) and survives untouched; it is deliberately not
// decoded back to Unicode, because rendering look-alike scripts is how homograph
// spoofing works.
function sanitizeHost(host) {
  return String(host || '').replace(/[^A-Za-z0-9.:[\]-]/g, '');
}

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

// sanitizeHost already removes every character this escapes. Both run anyway, so
// that widening the host charset later cannot silently open an injection.
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// Nothing here substitutes characters; it only drops them.
function shortHostName(host) {
  if (host.length <= SHORT_NAME_MAX) return host;
  // Servers are usually siblings under one domain, so the leftmost label is
  // what tells them apart.
  const label = host.split(':')[0].split('.')[0];
  if (label.length <= SHORT_NAME_MAX) return label;
  // Still too long: keep both ends, because operators put the distinguishing
  // part at either one.
  const keep = SHORT_NAME_MAX - 1;
  const head = Math.ceil(keep / 2);
  return `${label.slice(0, head)}…${label.slice(label.length - (keep - head))}`;
}

// Tabs, bookmarks and history have room for both. The host comes first so that
// wherever this is clipped, the server stays identifiable.
function documentTitle(host) {
  return `${host} — ${PRODUCT_NAME}`;
}

module.exports = {
  SHORT_NAME_MAX,
  PRODUCT_NAME,
  sanitizeHost,
  escapeHtml,
  shortHostName,
  documentTitle,
};
