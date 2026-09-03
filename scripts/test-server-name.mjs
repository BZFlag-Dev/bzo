import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  PRODUCT_NAME,
  SHORT_NAME_MAX,
  documentTitle,
  escapeHtml,
  sanitizeHost,
  shortHostName,
} = require('../server/server-name.cjs');

// Hosts that fit are never altered: the platform clips them gracefully.
assert.equal(shortHostName('bz.rikers.org'), 'bz.rikers.org');
assert.equal(shortHostName('orin-bzo.rikers.org'), 'orin-bzo.rikers.org');
assert.equal(shortHostName('10.0.0.5:3000'), '10.0.0.5:3000');
assert.equal(shortHostName('localhost:3000'), 'localhost:3000');
assert.equal(shortHostName('a'.repeat(SHORT_NAME_MAX)), 'a'.repeat(SHORT_NAME_MAX));

// Too long: drop the domain and keep the label that distinguishes siblings.
assert.equal(
  shortHostName('shortlabel.a-very-long-domain-name-indeed.example.com'),
  'shortlabel'
);
assert.equal(shortHostName(`${'a'.repeat(SHORT_NAME_MAX)}.example.com`), 'a'.repeat(SHORT_NAME_MAX));

// Label still too long: keep both ends, since either may carry the difference.
const monster = 'my-favorite-bzo-server-that-i-setup-last-tuesday.somewhere.example.com';
assert.equal(shortHostName(monster), 'my-favorite-…ast-tuesday');
assert.equal(shortHostName(monster).length, SHORT_NAME_MAX);

// Two servers distinguished only by the tail must not collapse to one label.
const a = shortHostName('bzo-server-run-by-tim-alpha.example.com');
const b = shortHostName('bzo-server-run-by-tim-bravo.example.com');
assert.notEqual(a, b, 'hosts differing only at the tail must keep distinct short names');

// Only ever drops characters, never substitutes them.
for (const host of [monster, 'bz.rikers.org', 'shortlabel.a-very-long-domain-name-indeed.example.com']) {
  const short = shortHostName(host);
  assert.ok(short.length <= SHORT_NAME_MAX, `${host} -> ${short} exceeds ${SHORT_NAME_MAX}`);
  for (const ch of short.replace('…', '')) {
    assert.ok(host.includes(ch), `short name for ${host} invented character ${ch}`);
  }
}

// The host leads the title so any truncation still identifies the server.
assert.equal(documentTitle('bz.rikers.org'), `bz.rikers.org — ${PRODUCT_NAME}`);
// Keep this assertion exact: a URL-like startsWith/includes check is ambiguous
// to CodeQL and adds no coverage beyond the complete title assertion above.

// A Host header is client-supplied, so it must never reach the page as markup.
assert.equal(sanitizeHost('bz.rikers.org'), 'bz.rikers.org');
assert.equal(sanitizeHost('localhost:3000'), 'localhost:3000');
assert.equal(sanitizeHost('[::1]:3000'), '[::1]:3000');
assert.equal(sanitizeHost('my<script>alert(0)</script>.example.com'), 'myscriptalert0script.example.com');
assert.equal(sanitizeHost('"><img src=x onerror=alert(1)>'), 'imgsrcxonerroralert1');
assert.equal(sanitizeHost(''), '');
assert.equal(sanitizeHost(undefined), '');
for (const hostile of ['<>&"\'', 'a\nb', 'a b', 'a\tb', 'a/b?c#d']) {
  const clean = sanitizeHost(hostile);
  assert.equal(clean, escapeHtml(clean), `sanitizeHost left markup in ${JSON.stringify(hostile)}`);
  assert.ok(!/[<>&"'\s/?#]/.test(clean), `sanitizeHost kept an unsafe character in ${JSON.stringify(hostile)}`);
}

// An internationalized domain reaches us already punycoded, and stays that way:
// decoding it back to Unicode would invite homograph spoofing.
assert.equal(sanitizeHost('xn--mnchen-3ya.example.com'), 'xn--mnchen-3ya.example.com');
assert.equal(shortHostName('xn--mnchen-3ya.example.com'), 'xn--mnchen-3ya');

assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
assert.equal(escapeHtml('a&b"c\'d'), 'a&amp;b&quot;c&#39;d');

console.log('server name tests passed');
