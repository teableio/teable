import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { ComputedReproLive } from '../layers/ComputedReproLive';
import { ComputedRepro, type ComputedReproInput } from '../services/ComputedRepro';
import { FIELD, syntheticStructure, TABLE_A, TABLE_B } from './__tests__/fixtures';

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

describe('repro computed pipeline (PGlite)', () => {
  it('exports, installs, seeds mock rows, applies a record-update trigger, and drains', async () => {
    const dir = await createTempDir('teable-repro-ok-');
    const structurePath = join(dir, 'structure.json');
    await writeFile(structurePath, JSON.stringify(syntheticStructure()));

    const result = await runRepro({
      structurePath,
      outDir: join(dir, 'artifact'),
      triggerKind: 'record-update',
      rowCount: 3,
      seed: 7,
    });

    expect(result.structure.source).toBe('file');
    expect(result.structure.sanitized).toBe(true);
    expect(Object.keys(result.structure.tableIdMap)).toEqual([TABLE_A, TABLE_B]);
    expect(result.structure.fieldIdMap[FIELD.formula]).toMatch(/^fld/);
    expect(result.trigger.kind).toBe('record-update');
    expect(result.trigger.fieldIds.length).toBeGreaterThan(0);
    expect(result.drain.processed).toBeGreaterThan(0);
    expect(result.failure.kind).toBe('none');
    expect(result.failure.lastError).toBeUndefined();
    expect(result.notes.join(' ')).toContain('@teable/v2-mock-records');

    const runReport = JSON.parse(await readFile(result.files.run, 'utf-8')) as {
      failure: { kind: string };
      trigger: { kind: string };
    };
    expect(runReport.failure.kind).toBe('none');
    expect(runReport.trigger.kind).toBe('record-update');
  }, 120_000);

  it('applies a field-update trigger from --trigger-json with declared ids', async () => {
    const dir = await createTempDir('teable-repro-field-');
    const structurePath = join(dir, 'structure.json');
    await writeFile(structurePath, JSON.stringify(syntheticStructure()));
    const triggerPath = join(dir, 'trigger.json');
    await writeFile(
      triggerPath,
      JSON.stringify({
        kind: 'field-update',
        tableId: TABLE_A,
        fieldId: FIELD.formula,
        field: { options: { expression: `{${FIELD.amount}}*3` } },
      })
    );

    const result = await runRepro({
      structurePath,
      outDir: join(dir, 'artifact'),
      triggerJsonPath: triggerPath,
      rowCount: 2,
    });

    expect(result.trigger.kind).toBe('field-update');
    expect(result.drain.processed).toBeGreaterThan(0);
    expect(result.failure.kind).toBe('none');
  }, 120_000);

  it('captures a deterministic computed failure with failedSql and the task trace', async () => {
    const dir = await createTempDir('teable-repro-fail-');
    const structurePath = join(dir, 'structure.json');
    await writeFile(structurePath, JSON.stringify(syntheticStructure()));

    const specPath = join(dir, 'computed-repro.pglite.spec.ts');
    const result = await runRepro({
      structurePath,
      outDir: join(dir, 'artifact'),
      emitSpecPath: specPath,
      triggerKind: 'record-update',
      rowCount: 3,
      seed: 11,
      fault: `column-type-drift:${FIELD.formula}`,
    });

    expect(result.failure.kind).toBe('dead_letter');
    expect(result.failure.failureKind).toBe('computed_code_bug');
    expect(result.failure.failurePhase).toBe('execute_plan');
    expect(result.failure.lastError).toBeTruthy();
    expect(result.failure.failedSql).toContain('update');
    expect(result.failure.postgres?.sqlState).toBe('42846');
    expect(result.failure.seedRecordIds).toBeTruthy();
    expect(result.drain.processed).toBeGreaterThan(0);

    const spec = await readFile(specPath, 'utf-8');
    expect(spec).toContain('createV2NodeTestContainer');
    expect(spec).toContain(`FAULT = "column-type-drift:${FIELD.formula}"`);
    expect(spec).toContain(
      "expect(lastError, 'expected the recorded computed failure').toBeTruthy()"
    );
  }, 120_000);
});
