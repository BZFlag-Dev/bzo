#!/usr/bin/env node
/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/BZFlag-Dev/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const changelogPath = resolve(rootDir, 'CHANGELOG.md');

function normalizeVersion(input) {
  if (!input || typeof input !== 'string') return '';
  return input.trim().replace(/^refs\/tags\//, '').replace(/^v/, '');
}

const tagInput = process.argv[2] || process.env.GITHUB_REF_NAME || process.env.npm_config_tag;
const version = normalizeVersion(tagInput);
if (!version) {
  console.error('Usage: node scripts/extract-changelog.mjs <tag-or-version>');
  process.exit(1);
}

const changelog = readFileSync(changelogPath, 'utf8');
const lines = changelog.split('\n');
const headingPrefix = `## [${version}]`;
const startIndex = lines.findIndex((line) => line.startsWith(headingPrefix));
if (startIndex < 0) {
  console.error(`No changelog section found for ${version}`);
  process.exit(1);
}

let endIndex = lines.length;
for (let index = startIndex + 1; index < lines.length; index += 1) {
  if (lines[index].startsWith('## [')) {
    endIndex = index;
    break;
  }
}

const headingLine = lines[startIndex].trim();
const body = lines.slice(startIndex + 1, endIndex).join('\n').trim();
process.stdout.write(`${headingLine}\n\n${body}\n`);
