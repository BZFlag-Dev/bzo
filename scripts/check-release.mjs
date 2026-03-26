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
const packageJsonPath = resolve(rootDir, 'package.json');
const packageLockPath = resolve(rootDir, 'package-lock.json');
const changelogPath = resolve(rootDir, 'CHANGELOG.md');

function fail(message) {
  console.error(`Release check failed: ${message}`);
  process.exit(1);
}

function normalizeVersion(input) {
  if (!input || typeof input !== 'string') return '';
  return input.trim().replace(/^refs\/tags\//, '').replace(/^v/, '');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function getChangelogSection(content, version) {
  const lines = content.split('\n');
  const headingPrefix = `## [${version}]`;
  const startIndex = lines.findIndex((line) => line.startsWith(headingPrefix));
  if (startIndex < 0) {
    return '';
  }

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('## [')) {
      endIndex = index;
      break;
    }
  }

  return lines.slice(startIndex + 1, endIndex).join('\n').trim();
}

const tagInput = process.argv[2] || process.env.GITHUB_REF_NAME || process.env.npm_config_tag;
if (!tagInput) {
  fail('missing tag/version argument');
}

const tagVersion = normalizeVersion(tagInput);
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tagVersion)) {
  fail(`tag "${tagInput}" is not a valid release version`);
}

const packageJson = readJson(packageJsonPath);
if (packageJson.version !== tagVersion) {
  fail(`package.json version ${packageJson.version} does not match tag ${tagVersion}`);
}

const packageLock = readJson(packageLockPath);
if (packageLock.version !== tagVersion || packageLock.packages?.['']?.version !== tagVersion) {
  fail('package-lock.json version does not match package.json');
}

const changelog = readFileSync(changelogPath, 'utf8');
const section = getChangelogSection(changelog, tagVersion);
if (!section) {
  fail(`CHANGELOG.md does not contain a section for ${tagVersion}`);
}

const placeholderPatterns = [
  /Describe user-visible changes here\./,
  /Describe updated behavior here\./,
  /Describe bug fixes here\./,
  /TBD/i,
];
for (const pattern of placeholderPatterns) {
  if (pattern.test(section)) {
    fail(`CHANGELOG.md section for ${tagVersion} still contains placeholder text`);
  }
}

if (!/[A-Za-z0-9]/.test(section)) {
  fail(`CHANGELOG.md section for ${tagVersion} is empty`);
}

console.log(`Release check passed for ${tagVersion}`);
