#!/usr/bin/env node
/**
 * Schema ownership check — spec §2.1.1 ("a module owns its tables"), rule R2.
 *
 * dependency-cruiser stops a module *importing* another module's schema. This
 * catches the other half: a module declaring or referencing a PostgreSQL schema
 * that isn't its own. Together they make "no cross-module DB reads" mechanical
 * rather than a code-review convention.
 *
 * Checks, for every module in the registry:
 *   1. schema.ts exists
 *   2. it declares exactly one pgSchema, named after the module
 *   3. no file in the module references another module's pgSchema name
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MODULES_DIR = join(ROOT, 'packages', 'api', 'src', 'modules');
const REGISTRY = join(MODULES_DIR, 'registry.ts');

const errors = [];

function fail(file, message) {
  errors.push(`${relative(ROOT, file).replace(/\\/g, '/')}: ${message}`);
}

async function readModuleNames() {
  const source = await readFile(REGISTRY, 'utf8');
  const block = source.match(/MODULE_NAMES\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!block) {
    throw new Error('Could not parse MODULE_NAMES from modules/registry.ts');
  }
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

async function collectTsFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collectTsFiles(full)));
    } else if (entry.name.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const moduleNames = await readModuleNames();

for (const name of moduleNames) {
  const moduleDir = join(MODULES_DIR, name);
  const schemaFile = join(moduleDir, 'schema.ts');

  if (!(await exists(moduleDir))) {
    errors.push(`modules/${name}: listed in registry.ts but the folder is missing`);
    continue;
  }
  if (!(await exists(schemaFile))) {
    errors.push(`modules/${name}: schema.ts is missing`);
    continue;
  }

  // 2. schema.ts declares exactly its own pgSchema
  const schemaSource = await readFile(schemaFile, 'utf8');
  const declared = [...schemaSource.matchAll(/pgSchema\(\s*'([^']+)'\s*\)/g)].map(
    (m) => m[1],
  );

  if (declared.length === 0) {
    fail(schemaFile, `declares no pgSchema — expected pgSchema('${name}')`);
  }
  for (const declaredName of declared) {
    if (declaredName !== name) {
      fail(
        schemaFile,
        `declares pgSchema('${declaredName}') but this module owns '${name}'`,
      );
    }
  }
  if (declared.length > 1) {
    fail(schemaFile, `declares ${declared.length} schemas — a module owns exactly one`);
  }

  // 3. no file in this module names another module's schema
  const others = moduleNames.filter((n) => n !== name);
  for (const file of await collectTsFiles(moduleDir)) {
    const source = await readFile(file, 'utf8');
    for (const other of others) {
      const pattern = new RegExp(`pgSchema\\(\\s*'${other}'\\s*\\)`);
      if (pattern.test(source)) {
        fail(file, `references pgSchema('${other}'), owned by the ${other} module`);
      }
    }
  }
}

// Folders on disk that aren't in the registry
const onDisk = (await readdir(MODULES_DIR, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

for (const dir of onDisk) {
  if (!moduleNames.includes(dir)) {
    errors.push(`modules/${dir}: exists on disk but is not in registry.ts`);
  }
}

if (errors.length > 0) {
  console.error('\nSchema ownership violations (spec §2.1.1, rule R2):\n');
  for (const error of errors) {
    console.error(`  ✗ ${error}`);
  }
  console.error(`\n${errors.length} violation(s). Fix the module, not the check.\n`);
  process.exit(1);
}

console.warn(`✓ Schema ownership clean across ${moduleNames.length} modules`);
