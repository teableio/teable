import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createV2PostgresPgliteDb } from '@teable/v2-adapter-db-postgres-pglite';

import type { OperationPreview, PreviewCapability } from '@teable/v2-command-explain';
import { Effect, Exit } from 'effect';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';

import { CliError } from '../../errors';

import { renderPreviewCapabilities } from './capabilities';
import {
  formatPreviewMeasure,
  parsePreviewInput,
  renderOperationPreview,
  requireReadyPreview,
  serializePreviewError,
} from './operation';

const fixturePath = fileURLToPath(new URL('./__fixtures__/field-convert.json', import.meta.url));

const packageDir = fileURLToPath(new URL('../../..', import.meta.url));

interface CliResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const runCli = (args: ReadonlyArray<string>): Promise<CliResult> => {
  const { promise, resolve, reject } = Promise.withResolvers<CliResult>();
  const child = spawn(
    'pnpm',
    ['exec', 'tsx', '--tsconfig', 'tsconfig.run.json', 'bin/run.ts', ...args],
    {
      cwd: packageDir,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.once('error', reject);
  child.once('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  return promise;
};

const preview = (outcome: OperationPreview['outcome']): OperationPreview => ({
  operation: 'field.convert',
  outcome,
  effects: [
    {
      code: 'field.conversion.type_change',
      kind: 'field.conversion',
      summary: 'The field type changes',
      measures: {
        changedFields: { basis: 'exact', value: 1, unit: 'fields' },
        affectedCells: {
          basis: 'unknown',
          unit: 'cells',
          reason: 'catalog evidence is unavailable',
        },
      },
    },
  ],
  blockers:
    outcome === 'blocked'
      ? [{ code: 'field.convert.permission_denied', message: 'Field update is denied' }]
      : [],
  warnings: [],
  coverage: {
    known: ['updateInputValidation'],
    unknown: outcome === 'incomplete' ? ['fieldOperationPolicies'] : [],
  },
  complexity: null,
  authorization: 'checked',
  observedAt: '2026-10-27T00:00:00.000Z',
  consistency: 'best-effort',
  requestDigest: `sha256:${'a'.repeat(64)}`,
  implementation: { plannerVersion: '1', executionPath: 'UpdateFieldHandler' },
});

describe('preview CLI', () => {
  it('accepts the field.convert smoke fixture and inline JSON', async () => {
    const fromFile = await Effect.runPromise(parsePreviewInput(fixturePath));
    const inline = await Effect.runPromise(
      parsePreviewInput(
        '{"tableId":"tblPreviewSmoke0000","fieldId":"fldPreviewSmoke0000","field":{"type":"singleLineText"}}'
      )
    );

    expect(fromFile).toEqual({
      tableId: 'tblPreviewSmoke0000',
      fieldId: 'fldPreviewSmoke0000',
      field: { type: 'singleLineText', name: 'Preview smoke converted field' },
    });
    expect(inline).toEqual({
      tableId: 'tblPreviewSmoke0000',
      fieldId: 'fldPreviewSmoke0000',
      field: { type: 'singleLineText' },
    });
  });

  it('returns a stable input error for neither valid JSON nor a readable JSON file', async () => {
    const error = await Effect.runPromise(
      parsePreviewInput('/missing/preview-input.json').pipe(Effect.flip)
    );

    expect(error.code).toBe('preview.input.invalid_json_or_file');
  });

  it('renders evidence basis, unknown coverage, and the empty-effects safety warning', () => {
    expect(formatPreviewMeasure({ basis: 'exact', value: 3, unit: 'records' })).toBe(
      '3 records (exact)'
    );
    expect(
      formatPreviewMeasure({
        basis: 'range',
        lower: 1,
        expected: 2,
        upper: null,
        unit: 'records',
        source: 'catalog',
      })
    ).toBe('1..? records (expected 2; catalog)');

    const rendered = renderOperationPreview(preview('incomplete'));
    expect(rendered).toContain('Outcome: incomplete');
    expect(rendered).toContain('affectedCells: unknown cells (catalog evidence is unavailable)');
    expect(rendered).toContain('Unknown coverage: fieldOperationPolicies');

    const withoutEffects = renderOperationPreview({ ...preview('ready'), effects: [] });
    expect(withoutEffects).toContain('an empty effect list is not evidence of safety');
  });

  it('uses stable non-zero semantics for blocked and incomplete previews', async () => {
    const ready = await Effect.runPromiseExit(requireReadyPreview(preview('ready')));
    const blocked = await Effect.runPromiseExit(requireReadyPreview(preview('blocked')));
    const incomplete = await Effect.runPromiseExit(requireReadyPreview(preview('incomplete')));

    expect(Exit.isSuccess(ready)).toBe(true);
    expect(Exit.isFailure(blocked)).toBe(true);
    expect(Exit.isFailure(incomplete)).toBe(true);

    const blockedError = await Effect.runPromise(
      requireReadyPreview(preview('blocked')).pipe(Effect.flip)
    );
    const incompleteError = await Effect.runPromise(
      requireReadyPreview(preview('incomplete')).pipe(Effect.flip)
    );
    expect(blockedError.code).toBe('preview.outcome.blocked');
    expect(incompleteError.code).toBe('preview.outcome.incomplete');
  });

  it('renders registry capability metadata without maintaining a second operation list', () => {
    const capabilities: ReadonlyArray<PreviewCapability> = [
      {
        operation: 'field.convert',
        canonicalWriteRoute: 'PATCH /tables/:tableId/fields/:fieldId',
        supportLevel: 'partial',
        requiredPermissionScope: 'field.update',
        detailLevels: ['summary', 'full'],
        limitations: ['Execution-only policies are not checked.'],
      },
    ];

    const rendered = renderPreviewCapabilities(capabilities);
    expect(rendered).toContain('field.convert [partial]');
    expect(rendered).toContain('permission: field.update');
    expect(rendered).toContain('Execution-only policies are not checked.');
  });

  it('preserves stable unsupported-operation and permission failure codes', () => {
    const unsupported = serializePreviewError(
      new CliError({
        code: 'preview.operation.unsupported',
        message: 'Unsupported preview operation',
      })
    );
    const denied = serializePreviewError(
      new CliError({ code: 'permission.denied', message: 'Permission denied' })
    );

    expect(unsupported.error.code).toBe('preview.operation.unsupported');
    expect(denied.error.code).toBe('permission.denied');
  });

  it('uses parser-equivalent case and boolean forms for database-free capabilities', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'teable-preview-capabilities-'));
    const dataDir = join(tempRoot, 'database');
    const connection = `pglite://${dataDir}`;

    try {
      const capabilityArgs = [
        ['preview', 'capabilities', '--connection', connection, '--json=true'],
        ['Preview', 'capabilities', `--connection=${connection}`, '--json=true'],
      ];
      for (const args of capabilityArgs) {
        const capabilities = await runCli(args);
        expect(capabilities.exitCode, `${args.join(' ')}\n${capabilities.stderr}`).toBe(0);
        const capabilityDto = JSON.parse(capabilities.stdout) as ReadonlyArray<PreviewCapability>;
        expect(capabilityDto.some(({ operation }) => operation === 'field.convert')).toBe(true);
      }

      await expect(access(dataDir)).rejects.toThrow();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it('uses the parsed separator route without bootstrapping application tables', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'teable-preview-separator-'));
    const dataDir = join(tempRoot, 'database');
    const connection = `pglite://${dataDir}`;

    try {
      const capabilities = await runCli([
        '--',
        'preview',
        'capabilities',
        `--connection=${connection}`,
        '--json',
      ]);
      expect(capabilities.exitCode, capabilities.stderr).toBe(0);
      const capabilityDto = JSON.parse(capabilities.stdout) as ReadonlyArray<PreviewCapability>;
      expect(capabilityDto.some(({ operation }) => operation === 'field.convert')).toBe(true);
      await expect(access(dataDir)).rejects.toThrow();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it('reports malformed and unsupported operations without bootstrapping application tables', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'teable-preview-invalid-operation-'));
    const dataDir = join(tempRoot, 'database');
    const connection = `pglite://${dataDir}`;

    try {
      const invalid = await runCli([
        'PREVIEW',
        'Operation',
        `--connection=${connection}`,
        '--operation',
        'field.convert',
        '--input',
        join(dataDir, 'missing-input.json'),
        '--json=true',
      ]);
      expect(invalid.exitCode).toBe(1);
      expect(invalid.stdout).toBe('');
      expect(invalid.stderr).toContain('preview.input.invalid_json_or_file');

      const unsupported = await runCli([
        'Preview',
        'operation',
        '--connection',
        connection,
        '--operation',
        'unsupported.preview',
        '--input',
        '{}',
        '--json=true',
      ]);
      expect(unsupported.exitCode).toBe(1);
      expect(unsupported.stdout).toBe('');
      expect(unsupported.stderr).toContain('preview.operation.unsupported');

      const db = await createV2PostgresPgliteDb({ pg: { connectionString: dataDir } });
      try {
        const publicTables = await sql<{ tableName: string }>`
            select tablename as "tableName"
            from pg_catalog.pg_tables
            where schemaname = 'public'
          `.execute(db);
        expect(publicTables.rows).toEqual([]);
      } finally {
        await db.destroy();
      }
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it('runs an unrelated command when an option value is preview', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'teable-preview-option-value-'));
    const dataDir = join(tempRoot, 'database');

    try {
      const result = await runCli([
        'tables',
        'create',
        '--connection',
        `pglite://${dataDir}`,
        '--base-id',
        'bsePreviewOptionValue',
        '--name',
        'preview',
      ]);

      expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('ok: true');
      expect(result.stdout).toContain('command: tables.create');
      expect(result.stdout).toContain('tableName: preview');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it('keeps global log-level preview capabilities JSON-only and database-free', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'teable-preview-cli-global-'));
    const dataDir = join(tempRoot, 'database');
    const connection = `pglite://${dataDir}`;

    try {
      const capabilities = await runCli([
        '--log-level',
        'debug',
        'preview',
        'capabilities',
        `--connection=${connection}`,
        '--json',
      ]);

      expect(capabilities.exitCode, capabilities.stderr).toBe(0);
      const capabilityDto = JSON.parse(capabilities.stdout) as ReadonlyArray<PreviewCapability>;
      expect(capabilityDto.some(({ operation }) => operation === 'field.convert')).toBe(true);
      await expect(access(dataDir)).rejects.toThrow();

      const operation = await runCli([
        '--log-level',
        'debug',
        'preview',
        'operation',
        `--connection=${connection}`,
        '--operation',
        'field.convert',
        '--input',
        fixturePath,
        '--json',
      ]);
      expect(operation.exitCode).toBe(1);
      expect(operation.stdout).toBe('');

      const db = await createV2PostgresPgliteDb({ pg: { connectionString: dataDir } });
      try {
        const publicTables = await sql<{ tableName: string }>`
          select tablename as "tableName"
          from pg_catalog.pg_tables
          where schemaname = 'public'
        `.execute(db);
        expect(publicTables.rows).toEqual([]);
      } finally {
        await db.destroy();
      }
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
