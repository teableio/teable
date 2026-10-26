import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { ComputedReproLive } from '../layers/ComputedReproLive';
import { ComputedRepro, type ComputedReproInput } from '../services/ComputedRepro';
import {
  FIELD,
  SECRET_CELL_VALUE,
  SECRET_CHOICE_NAME,
  SECRET_FIELD_NAME,
  SECRET_TABLE_NAME,
  SECRET_TABLE_NAME_B,
  syntheticStructure,
} from './__tests__/fixtures';
import { sanitizeStructure, type ReproStructure } from './structure';

const runRepro = async (input: ComputedReproInput) => {
  const program = Effect.gen(function* () {
    const repro = yield* ComputedRepro;
    return yield* repro.run(input);
  });
  return Effect.runPromise(program.pipe(Effect.provide(ComputedReproLive)));
};

const tempDirs: string[] = [];

const createTempDir = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const readArtifact = async (dir: string): Promise<string> => {
  const entries = await readdir(dir);
  const chunks: string[] = [];
  for (const entry of entries) {
    chunks.push(await readFile(join(dir, entry), 'latin1'));
  }
  return chunks.join('\n');
};

describe('repro computed sanitization', () => {
  it('keeps original names and cell values out of the artifact', async () => {
    const dir = await createTempDir('teable-repro-sanitize-');
    const structurePath = join(dir, 'structure.json');
    await writeFile(structurePath, JSON.stringify(syntheticStructure()));

    const specPath = join(dir, 'computed-repro.pglite.spec.ts');
    const result = await runRepro({
      structurePath,
      outDir: join(dir, 'artifact'),
      emitSpecPath: specPath,
      triggerKind: 'record-update',
      rowCount: 2,
    });

    const artifact = await readArtifact(result.artifactDir);
    const spec = await readFile(specPath, 'utf-8');
    const combined = `${artifact}\n${spec}`;

    for (const secret of [
      SECRET_TABLE_NAME,
      SECRET_TABLE_NAME_B,
      SECRET_FIELD_NAME,
      SECRET_CHOICE_NAME,
      SECRET_CELL_VALUE,
    ]) {
      expect(combined, `artifact leaked "${secret}"`).not.toContain(secret);
    }

    const structure = JSON.parse(await readFile(result.files.structureJson, 'utf-8')) as {
      name: string;
      tables: Array<{ name: string; fields: Array<{ name: string }> }>;
    };
    expect(structure.name).toBe('Repro Base');
    expect(structure.tables.every((table) => /^Table_\d+$/.test(table.name))).toBe(true);
    expect(
      structure.tables.every((table) =>
        table.fields.every((field) => /^Field_\d+$/.test(field.name))
      )
    ).toBe(true);

    expect(result.idMapPath).toBe(`${result.artifactDir}.id-map.json`);
    const idMap = JSON.parse(await readFile(result.idMapPath!, 'utf-8')) as {
      tables: Record<string, string>;
      fields: Record<string, string>;
      scrubbedPaths: string[];
    };
    expect(Object.values(idMap.tables)).toContain(SECRET_TABLE_NAME);
    expect(Object.values(idMap.fields)).toContain(SECRET_FIELD_NAME);
    expect(Object.values(idMap.fields)).toContain(SECRET_CHOICE_NAME);
    expect(JSON.stringify(idMap)).not.toContain(SECRET_CELL_VALUE);

    const sanitizedStructure = JSON.parse(
      await readFile(result.files.structureJson, 'utf-8')
    ) as ReproStructure;
    expect(JSON.stringify(sanitizedStructure)).not.toContain('"filter"');
  }, 120_000);

  it('defaults the artifact directory under the git-ignored .tmp tree', async () => {
    const dir = await createTempDir('teable-repro-default-');
    const structurePath = join(
      dir,
      `structure-default-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
    );
    await writeFile(structurePath, JSON.stringify(syntheticStructure()));

    const result = await runRepro({ structurePath, triggerKind: 'record-update', rowCount: 1 });
    try {
      const expectedRoot = resolve(process.cwd(), '.tmp', 'repro');
      expect(result.artifactDir.startsWith(`${expectedRoot}${sep}`)).toBe(true);
      expect(result.files.structureJson.startsWith(`${expectedRoot}${sep}`)).toBe(true);
      expect(result.idMapPath?.startsWith(`${expectedRoot}${sep}`)).toBe(true);
    } finally {
      await rm(result.artifactDir, { recursive: true, force: true });
      if (result.idMapPath) await rm(result.idMapPath, { force: true });
    }
  }, 120_000);

  it('replaces filter literals inside field options with typed placeholders', () => {
    const structure = syntheticStructure() as unknown as ReproStructure;
    structure.tables[0]!.fields[2]!.options = {
      expression: `{${FIELD.amount}}*2`,
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: FIELD.amount, operator: 'is', value: SECRET_CELL_VALUE }],
      },
    };

    const { structure: sanitized, idMap } = sanitizeStructure(structure);

    expect(JSON.stringify(sanitized)).not.toContain(SECRET_CELL_VALUE);
    expect(idMap.scrubbedPaths).toContain(
      `${structure.tables[0]!.id}.${FIELD.formula}.options.filter.filterSet[0].value`
    );
  });
});
