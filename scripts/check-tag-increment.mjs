#!/usr/bin/env node
/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function fail(message) {
  console.error(`Tag increment check failed: ${message}`);
  process.exit(1);
}

function normalizeTag(input) {
  if (!input || typeof input !== 'string') return '';
  return input.trim().replace(/^refs\/tags\//, '');
}

function parseVersion(input) {
  const tag = normalizeTag(input);
  const version = tag.replace(/^v/, '');
  const match = semverPattern.exec(version);
  if (!match) return null;

  return {
    tag,
    version,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: [],
  };
}

function compareIdentifiers(left, right) {
  const leftIsNumeric = /^\d+$/.test(left);
  const rightIsNumeric = /^\d+$/.test(right);

  if (leftIsNumeric && rightIsNumeric) return Number(left) - Number(right);
  if (leftIsNumeric) return -1;
  if (rightIsNumeric) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareVersions(left, right) {
  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) return left[field] - right[field];
  }

  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (index >= left.prerelease.length) return -1;
    if (index >= right.prerelease.length) return 1;

    const comparison = compareIdentifiers(left.prerelease[index], right.prerelease[index]);
    if (comparison !== 0) return comparison;
  }

  return 0;
}

function readReleaseTags() {
  try {
    return execFileSync('git', ['tag', '--list', 'v*'], {
      cwd: rootDir,
      encoding: 'utf8',
    })
      .split(/\r?\n/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  } catch (error) {
    fail(`unable to read release tags from Git: ${error.message}`);
  }
}

const tagInput = process.argv[2] || process.env.GITHUB_REF_NAME;
if (!tagInput) {
  fail('missing tag argument');
}

const candidate = parseVersion(tagInput);
if (!candidate) {
  fail(`tag "${tagInput}" must be a stable SemVer release tag in the form vX.Y.Z (prerelease and build metadata are not published)`);
}

const releaseTags = readReleaseTags();
const parsedTags = [];
for (const tag of releaseTags) {
  const parsed = parseVersion(tag);
  if (parsed) {
    parsedTags.push(parsed);
  } else {
    console.warn(`Ignoring non-SemVer release tag "${tag}"`);
  }
}

function readTagCommit(tag) {
  try {
    return execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}^{}`], {
      cwd: rootDir,
      encoding: 'utf8',
    }).trim();
  } catch (error) {
    fail(`unable to resolve release tag "${tag}": ${error.message}`);
  }
}

const currentRef = normalizeTag(process.env.GITHUB_REF_NAME || process.env.GITHUB_REF);
const currentSha = process.env.GITHUB_SHA || '';
const candidateTagExists = parsedTags.some((tag) => tag.tag === candidate.tag);
const isCurrentWorkflowTag = currentRef === candidate.tag && Boolean(currentSha);

if (candidateTagExists && !isCurrentWorkflowTag) {
  fail(`tag "${candidate.tag}" already exists in the release history`);
}

if (candidateTagExists && isCurrentWorkflowTag && readTagCommit(candidate.tag) !== currentSha) {
  fail(`tag "${candidate.tag}" does not resolve to the workflow commit`);
}

if (parsedTags.some((tag) => tag.version === candidate.version && tag.tag !== candidate.tag)) {
  fail(`release version "${candidate.version}" already exists under another tag`);
}

const previous = parsedTags
  .filter((tag) => tag.tag !== candidate.tag)
  .sort((left, right) => compareVersions(right, left))[0];

if (!previous) {
  console.log(`Tag increment check passed: ${candidate.tag} is the first release tag`);
  process.exit(0);
}

if (compareVersions(candidate, previous) <= 0) {
  fail(`tag "${candidate.tag}" must be greater than the previous release tag "${previous.tag}"`);
}

console.log(`Tag increment check passed: ${candidate.tag} is greater than ${previous.tag}`);
