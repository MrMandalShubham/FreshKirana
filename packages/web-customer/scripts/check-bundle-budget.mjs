#!/usr/bin/env node
/**
 * Enforces the §4.1 initial-JS budget.
 *
 * The spec targets a mid-range Android on 4G with **≤ 200 KB of gzipped
 * initial JavaScript**. A budget nobody measures is a wish, so this fails the
 * build rather than printing a warning: bundle size only ever grows by
 * accident, one convenient dependency at a time, and the cost lands on the
 * customers least able to absorb it.
 *
 * Measures the entry chunks for the home route — what a first-time visitor
 * downloads before anything renders — not the whole app.
 */

import { gzipSync } from 'node:zlib';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const BUDGET_BYTES = 200 * 1024;

/** Which manifest entry represents the first page a visitor lands on. */
const HOME_ROUTE_KEYS = ['/[locale]/page', '/page'];

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const manifestPath = join(ROOT, '.next', 'app-build-manifest.json');

if (!(await exists(manifestPath))) {
  console.error('No .next/app-build-manifest.json — run `npm run build` first.');
  process.exit(1);
}

const manifest = await readJson(manifestPath);
const pages = manifest.pages ?? {};

const routeKey = HOME_ROUTE_KEYS.find((key) => pages[key]) ?? Object.keys(pages)[0];
if (!routeKey) {
  console.error('Build manifest contains no pages.');
  process.exit(1);
}

const files = [...new Set(pages[routeKey])].filter((file) => file.endsWith('.js'));

let total = 0;
const breakdown = [];

for (const file of files) {
  const path = join(ROOT, '.next', file);
  if (!(await exists(path))) continue;

  const gzipped = gzipSync(await readFile(path)).length;
  total += gzipped;
  breakdown.push({ file, gzipped });
}

breakdown.sort((a, b) => b.gzipped - a.gzipped);

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

console.warn(`\nInitial JS for ${routeKey} (gzipped):\n`);
for (const entry of breakdown.slice(0, 8)) {
  console.warn(`  ${kb(entry.gzipped).padStart(9)}  ${entry.file}`);
}
if (breakdown.length > 8) {
  console.warn(`  ${'…'.padStart(9)}  and ${breakdown.length - 8} more`);
}

console.warn(`\n  total ${kb(total)} of ${kb(BUDGET_BYTES)} budget\n`);

if (total > BUDGET_BYTES) {
  console.error(
    `Initial JS is ${kb(total)}, over the ${kb(BUDGET_BYTES)} budget in spec §4.1.\n` +
      'Reduce it rather than raising the budget: this is what a shopper on a\n' +
      'mid-range Android over 4G waits for before anything appears.\n',
  );
  process.exit(1);
}

console.warn(`Within budget, ${kb(BUDGET_BYTES - total)} to spare.\n`);
