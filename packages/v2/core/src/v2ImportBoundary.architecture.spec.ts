import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const v2Root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const packagesRoot = resolve(v2Root, '..');
const boundaryPreset = join(packagesRoot, 'eslint-config-bases/src/bases/v2-import-boundary.json');
const oxlintBin = join(dirname(require.resolve('oxlint/package.json')), 'bin/oxlint');

// Manifests are repository-owned fixtures, not external inputs.
const packages = readdirSync(v2Root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => {
    const dir = join(v2Root, entry.name);
    let raw: string;
    try {
      raw = readFileSync(join(dir, 'package.json'), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const manifest = JSON.parse(raw) as { name: string; scripts?: { lint?: string } };
    return [{ name: manifest.name, dir, lint: manifest.scripts?.lint }];
  });

const runOxlint = (config: string, file: string) => {
  const result = spawnSync(process.execPath, [oxlintBin, '-c', config, file], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

describe('v2 import boundary', () => {
  // The full scan gets its existing 30s process budget plus 5s of runner overhead.
  it('keeps all v2 package sources free of legacy imports', { timeout: 35_000 }, () => {
    const result = spawnSync(
      process.execPath,
      [
        oxlintBin,
        '-c',
        boundaryPreset,
        '--disable-nested-config',
        '-A',
        'all',
        ...packages.map(({ dir }) => join(dir, 'src')),
      ],
      { encoding: 'utf8', timeout: 30_000 }
    );
    if (result.error) throw result.error;
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  });

  it.each(packages)(
    'rejects legacy imports through $name config, including spec files',
    ({ dir, lint }) => {
      expect(lint, 'Each v2 package must expose an Oxlint entry point').toMatch(/\boxlint\b/);
      const fixtureDir = mkdtempSync(join(tmpdir(), 'v2-boundary-'));
      try {
        const file = join(fixtureDir, 'blocked.spec.ts');
        writeFileSync(file, "export * from '@teable/core';\n");
        const result = runOxlint(join(dir, '.oxlintrc.json'), file);
        expect(result.output).toContain('teable(no-legacy-core-import)');
        expect(result.status).toBe(1);
      } finally {
        rmSync(fixtureDir, { recursive: true, force: true });
      }
    }
  );

  it('rejects each legacy import form and resolved filesystem path without rejecting v2 imports', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'v2-boundary-'));
    try {
      const legacyCore = join(packagesRoot, 'core/src/index.ts');
      const backend = resolve(
        packagesRoot,
        '../apps/nestjs-backend/src/features/table/table.service.ts'
      );
      const enterprise = resolve(packagesRoot, '../../enterprise/backend-ee/src/app.module.ts');
      const relativeBackend = relative(fixtureDir, backend).split('\\').join('/');
      const blocked = [
        "import { A } from '@teable/core';",
        "import type { B } from '@teable/core/models';",
        "export * from '@teable/backend';",
        "export type { C } from '@teable/backend-ee/configs';",
        "const d = import('@teable/openapi');",
        "const r = require('@teable/db-main-prisma');",
        "type T = import('@teable/core').Foo;",
        "import Eq = require('@teable/core');",
        'const template = import(`@teable/core`);',
        `export * from ${JSON.stringify(legacyCore)};`,
        `export * from ${JSON.stringify(backend)};`,
        `export * from ${JSON.stringify(enterprise)};`,
        `export * from ${JSON.stringify(relativeBackend)};`,
        `export * from ${JSON.stringify(pathToFileURL(backend).href)};`,
      ];
      const badFile = join(fixtureDir, 'blocked.ts');
      writeFileSync(badFile, `${blocked.join('\n')}\n`);
      const bad = runOxlint(boundaryPreset, badFile);
      expect(bad.output.split('teable(no-legacy-core-import)').length - 1).toBe(blocked.length);
      expect(bad.status).toBe(1);

      const goodFile = join(fixtureDir, 'allowed.ts');
      writeFileSync(
        goodFile,
        [
          "export * from '@teable/v2-core';",
          "export * from '@teable/formula';",
          "export * from '@teable/core-utils';",
          "export * from '@teable/backend-tools';",
          "export * from './local';",
          `export * from ${JSON.stringify(join(v2Root, 'core/src/index.ts'))};`,
          "export type { A } from '@teable/v2-core';",
          "export const dynamic = import('@teable/v2-core');",
          "export const node = require('node:fs');",
        ].join('\n')
      );
      const good = runOxlint(boundaryPreset, goodFile);
      expect(good.output).not.toContain('no-legacy-core-import');
      expect(good.status).toBe(0);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
