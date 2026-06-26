import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filterPgRestoreListForForeignKeys,
  PG_RESTORE_LIST_STDOUT_LIMIT,
  postgresCopyToolsForStrategy,
  parsePsqlInsertRowCount,
  parsePsqlCopyRowCount,
  REQUIRED_PGCOPYDB_COPY_TOOLS,
  REQUIRED_POSTGRES_COPY_TOOLS,
  SpaceDataDbCopyService,
} from './space-data-db-copy.service';

const sourceUrl = 'postgresql://source.example/teable';
const targetUrl = 'postgresql://target.example/teable';
const workDir = '/tmp/sdmjxxx';
const psqlCommand = 'psql';
const historyTargetArgs = ['history-target'];
const trashTargetArgs = ['trash-target'];

describe('SpaceDataDbCopyService', () => {
  const processRunner = {
    run: vi.fn(),
    runPipeline: vi.fn(),
  };

  beforeEach(() => {
    processRunner.run.mockReset();
    processRunner.runPipeline.mockReset();
  });

  it('parses psql COPY row counts from command output', () => {
    expect(parsePsqlCopyRowCount('COPY 42\n')).toBe(42);
    expect(parsePsqlCopyRowCount('notice\nCOPY 3\nCOPY 4\n')).toBe(4);
    expect(parsePsqlCopyRowCount('')).toBeNull();
  });

  it('parses psql INSERT row counts from command output', () => {
    expect(parsePsqlInsertRowCount('INSERT 0 42\n')).toBe(42);
    expect(parsePsqlInsertRowCount('BEGIN\nINSERT 0 3\nINSERT 0 4\nCOMMIT\n')).toBe(4);
    expect(parsePsqlInsertRowCount('')).toBeNull();
  });

  it('checks required PostgreSQL client tools before copy work starts', async () => {
    processRunner.run.mockImplementation((plan: { command: string; args: string[] }) =>
      Promise.resolve({
        command: plan.command,
        args: plan.args,
        exitCode: 0,
        signal: null,
        stderr: '',
        stdout: '',
        startedAt: '2026-05-06T00:00:00.000Z',
        completedAt: '2026-05-06T00:00:01.000Z',
        durationMs: 1000,
      })
    );
    const service = new SpaceDataDbCopyService(processRunner as never);

    await expect(
      service.assertPostgresToolsAvailable('pg_dump_restore', { timeoutMs: 5000 })
    ).resolves.toHaveLength(REQUIRED_POSTGRES_COPY_TOOLS.length);

    for (const [index, command] of REQUIRED_POSTGRES_COPY_TOOLS.entries()) {
      expect(processRunner.run).toHaveBeenNthCalledWith(
        index + 1,
        { command, args: ['--version'] },
        { timeoutMs: 5000 }
      );
    }
  });

  it('requires pgcopydb only when the pgcopydb base-schema strategy is selected', () => {
    expect(postgresCopyToolsForStrategy('pg_dump_restore')).toEqual([
      'pg_dump',
      'pg_restore',
      'psql',
    ]);
    expect(postgresCopyToolsForStrategy('pg_dump_stream_restore')).toEqual([
      'pg_dump',
      'pg_restore',
      'psql',
    ]);
    expect(postgresCopyToolsForStrategy('pgcopydb')).toEqual(REQUIRED_PGCOPYDB_COPY_TOOLS);
  });

  it('streams pg_dump into pg_restore for base schema copies by default', async () => {
    processRunner.runPipeline.mockResolvedValueOnce({
      source: { command: 'pg_dump', args: [], exitCode: 0, signal: null, stderr: '', stdout: '' },
      target: {
        command: 'pg_restore',
        args: [],
        exitCode: 0,
        signal: null,
        stderr: '',
        stdout: '',
      },
    });
    const service = new SpaceDataDbCopyService(processRunner as never);

    await expect(
      service.copyBaseSchemas({
        sourceUrl,
        targetUrl,
        schemaNames: ['bsebbb', 'bseaaa'],
        workDir,
        jobs: 2,
        processOptions: { timeoutMs: 10_000 },
      })
    ).resolves.toMatchObject({
      strategy: 'pg_dump_stream_restore',
      stream: {
        source: { command: 'pg_dump' },
        target: { command: 'pg_restore' },
      },
    });

    expect(processRunner.run).not.toHaveBeenCalled();
    expect(processRunner.runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({
          command: 'pg_dump',
          args: expect.arrayContaining(['--schema', '"bseaaa"', '--schema', '"bsebbb"']),
        }),
        target: expect.objectContaining({ command: 'pg_restore' }),
      }),
      { timeoutMs: 10_000 }
    );
  });

  it('executes pg_dump before pg_restore when the dump/restore strategy is selected', async () => {
    processRunner.run
      .mockResolvedValueOnce({ command: 'pg_dump', exitCode: 0, args: [], stderr: '', stdout: '' })
      .mockResolvedValueOnce({
        command: 'pg_restore',
        exitCode: 0,
        args: [],
        stderr: '',
        stdout: '',
      });
    const service = new SpaceDataDbCopyService(processRunner as never);

    await expect(
      service.copyBaseSchemas({
        sourceUrl,
        targetUrl,
        schemaNames: ['bsebbb', 'bseaaa'],
        workDir,
        jobs: 2,
        strategy: 'pg_dump_restore',
        processOptions: { timeoutMs: 10_000 },
      })
    ).resolves.toMatchObject({
      strategy: 'pg_dump_restore',
      dump: { command: 'pg_dump' },
      restore: { command: 'pg_restore' },
    });

    expect(processRunner.run).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        command: 'pg_dump',
        args: expect.arrayContaining(['--schema', '"bseaaa"', '--schema', '"bsebbb"']),
      }),
      { timeoutMs: 10_000 }
    );
    expect(processRunner.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ command: 'pg_restore' }),
      { timeoutMs: 10_000 }
    );
  });

  it('streams pg_dump into pg_restore for base schema copies when selected', async () => {
    processRunner.runPipeline.mockResolvedValueOnce({
      source: { command: 'pg_dump', args: [], exitCode: 0, signal: null, stderr: '', stdout: '' },
      target: {
        command: 'pg_restore',
        args: [],
        exitCode: 0,
        signal: null,
        stderr: '',
        stdout: '',
      },
    });
    const service = new SpaceDataDbCopyService(processRunner as never);

    await expect(
      service.copyBaseSchemas({
        sourceUrl,
        targetUrl,
        schemaNames: ['bsebbb', 'bseaaa'],
        workDir,
        strategy: 'pg_dump_stream_restore',
        processOptions: { timeoutMs: 10_000 },
      })
    ).resolves.toMatchObject({
      strategy: 'pg_dump_stream_restore',
      stream: {
        source: { command: 'pg_dump' },
        target: { command: 'pg_restore' },
      },
    });

    expect(processRunner.run).not.toHaveBeenCalled();
    expect(processRunner.runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({
          command: 'pg_dump',
          args: expect.arrayContaining(['--format=custom']),
        }),
        target: expect.objectContaining({ command: 'pg_restore' }),
      }),
      { timeoutMs: 10_000 }
    );
    expect(processRunner.runPipeline.mock.calls[0][0].source.args).not.toEqual(
      expect.arrayContaining(['--file', '-'])
    );
  });

  it('filters out-of-space foreign keys from pg_restore list before restore', async () => {
    const workDir = await mkdtemp(path.join(tmpdir(), 'teable-pg-restore-list-'));
    processRunner.run
      .mockResolvedValueOnce({ command: 'pg_dump', exitCode: 0, args: [], stderr: '', stdout: '' })
      .mockResolvedValueOnce({
        command: 'pg_restore',
        exitCode: 0,
        args: ['--list'],
        stderr: '',
        stdout: [
          '; archive TOC',
          '181; 1259 1 TABLE bse9Jpr5JmgTTXRYHWh Biao_GeyaAMdfes85 postgres',
          '182; 2606 2 FK CONSTRAINT bse9Jpr5JmgTTXRYHWh Biao_GeyaAMdfes85 fk___fk_fldP7S7LNeXsLsEFFhr postgres',
          '183; 2606 3 FK CONSTRAINT bse9Jpr5JmgTTXRYHWh Biao_GeyaAMdfes85 fk_keep_in_scope postgres',
          '',
        ].join('\n'),
      })
      .mockResolvedValueOnce({
        command: 'pg_restore',
        exitCode: 0,
        args: [],
        stderr: '',
        stdout: '',
      });
    const service = new SpaceDataDbCopyService(processRunner as never);

    try {
      await expect(
        service.copyBaseSchemas({
          sourceUrl,
          targetUrl,
          schemaNames: ['bse9Jpr5JmgTTXRYHWh'],
          workDir,
          jobs: 2,
          excludedForeignKeys: [
            {
              schemaName: 'bse9Jpr5JmgTTXRYHWh',
              tableName: 'Biao_GeyaAMdfes85',
              constraintName: 'fk___fk_fldP7S7LNeXsLsEFFhr',
              referencedSchemaName: 'bsemNMekh61Et',
              referencedTableName: 'Newtable_tblXTN8jAZ9i7omvC8u',
            },
          ],
          processOptions: { timeoutMs: 10_000 },
        })
      ).resolves.toMatchObject({
        strategy: 'pg_dump_restore',
        restoreList: { command: 'pg_restore' },
        filteredRestoreList: {
          requestedForeignKeyCount: 1,
          excludedEntryCount: 1,
        },
      });

      const restoreCall = processRunner.run.mock.calls[2][0];
      const restoreListOptions = processRunner.run.mock.calls[1][1];
      expect(restoreListOptions).toMatchObject({
        timeoutMs: 10_000,
        stdoutLimit: PG_RESTORE_LIST_STDOUT_LIMIT,
      });

      expect(restoreCall).toEqual(
        expect.objectContaining({
          command: 'pg_restore',
          args: expect.arrayContaining([
            '--use-list',
            path.join(workDir, 'base-schemas.restore.list'),
          ]),
        })
      );

      const listFile = await readFile(path.join(workDir, 'base-schemas.restore.list'), 'utf8');
      expect(listFile).not.toContain('fk___fk_fldP7S7LNeXsLsEFFhr');
      expect(listFile).toContain('fk_keep_in_scope');
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it('filters pg_restore list entries by schema table and foreign key names', () => {
    const filtered = filterPgRestoreListForForeignKeys(
      [
        '182; 2606 2 FK CONSTRAINT bsexxx sheet1 fk_out_of_scope postgres',
        '183; 2606 3 FK CONSTRAINT bsexxx sheet2 fk_out_of_scope postgres',
        '184; 2606 4 CONSTRAINT bsexxx sheet1 fk_out_of_scope postgres',
        '',
      ].join('\n'),
      [
        {
          schemaName: 'bsexxx',
          tableName: 'sheet1',
          constraintName: 'fk_out_of_scope',
          referencedSchemaName: 'bseyyy',
          referencedTableName: 'sheet2',
        },
      ]
    );

    expect(filtered.excludedEntryCount).toBe(1);
    expect(filtered.content).not.toContain('182;');
    expect(filtered.content).toContain('183;');
    expect(filtered.content).toContain('184;');
  });

  it('attaches separate progress hooks to pg_dump and pg_restore', async () => {
    processRunner.run
      .mockResolvedValueOnce({ command: 'pg_dump', exitCode: 0, args: [], stderr: '', stdout: '' })
      .mockResolvedValueOnce({
        command: 'pg_restore',
        exitCode: 0,
        args: [],
        stderr: '',
        stdout: '',
      });
    const service = new SpaceDataDbCopyService(processRunner as never);
    const onDumpProgressPoll = vi.fn();
    const onRestoreProgressPoll = vi.fn();
    const baseOnPoll = vi.fn();

    await service.copyBaseSchemas({
      sourceUrl,
      targetUrl,
      schemaNames: ['bsexxx'],
      workDir,
      strategy: 'pg_dump_restore',
      processOptions: { timeoutMs: 10_000, pollMs: 250, onPoll: baseOnPoll },
      hooks: {
        onDumpProgressPoll,
        onRestoreProgressPoll,
      },
    });

    const dumpOptions = processRunner.run.mock.calls[0][1];
    const restoreOptions = processRunner.run.mock.calls[1][1];
    await dumpOptions.onPoll();
    await restoreOptions.onPoll();

    expect(baseOnPoll).toHaveBeenCalledTimes(2);
    expect(onDumpProgressPoll).toHaveBeenCalledTimes(1);
    expect(onRestoreProgressPoll).toHaveBeenCalledTimes(1);
    expect(dumpOptions).toMatchObject({ timeoutMs: 10_000, pollMs: 250 });
    expect(restoreOptions).toMatchObject({ timeoutMs: 10_000, pollMs: 250 });
  });

  it('does not run restore when dump fails', async () => {
    processRunner.run.mockRejectedValueOnce(new Error('dump failed'));
    const service = new SpaceDataDbCopyService(processRunner as never);

    await expect(
      service.copyBaseSchemas({
        sourceUrl,
        targetUrl,
        schemaNames: ['bsexxx'],
        workDir,
        strategy: 'pg_dump_restore',
      })
    ).rejects.toThrow('dump failed');

    expect(processRunner.run).toHaveBeenCalledTimes(1);
    expect(processRunner.runPipeline).not.toHaveBeenCalled();
  });

  it('writes a pgcopydb filter file and runs pgcopydb when explicitly selected', async () => {
    const workDir = await mkdtemp(path.join(tmpdir(), 'teable-pgcopydb-plan-'));
    processRunner.run.mockResolvedValueOnce({
      command: 'pgcopydb',
      exitCode: 0,
      args: [],
      stderr: '',
      stdout: '',
    });
    const service = new SpaceDataDbCopyService(processRunner as never);

    try {
      await expect(
        service.copyBaseSchemas({
          sourceUrl,
          targetUrl,
          schemaNames: ['bsebbb', 'bseaaa'],
          workDir,
          jobs: 2,
          strategy: 'pgcopydb',
          processOptions: { timeoutMs: 10_000 },
        })
      ).resolves.toMatchObject({
        strategy: 'pgcopydb',
        pgcopydb: { command: 'pgcopydb' },
      });

      expect(processRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'pgcopydb',
          args: expect.arrayContaining([
            'copy',
            'db',
            '--filters',
            path.join(workDir, 'pgcopydb-base-schemas.filter.ini'),
          ]),
        }),
        { timeoutMs: 10_000 }
      );
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it('rejects pgcopydb when out-of-space foreign keys need filtered restore entries', async () => {
    const service = new SpaceDataDbCopyService(processRunner as never);

    await expect(
      service.copyBaseSchemas({
        sourceUrl,
        targetUrl,
        schemaNames: ['bsexxx'],
        workDir,
        strategy: 'pgcopydb',
        excludedForeignKeys: [
          {
            schemaName: 'bsexxx',
            tableName: 'sheet1',
            constraintName: 'fk_out_of_scope',
            referencedSchemaName: 'bseyyy',
            referencedTableName: 'sheet2',
          },
        ],
      })
    ).rejects.toThrow('pgcopydb base schema copy does not support filtering');

    expect(processRunner.run).not.toHaveBeenCalled();
  });

  it('executes shared table COPY pipelines sequentially', async () => {
    processRunner.runPipeline
      .mockResolvedValueOnce({
        source: { command: 'psql', args: [], exitCode: 0, signal: null, stderr: '', stdout: '' },
        target: {
          command: 'psql',
          args: [],
          exitCode: 0,
          signal: null,
          stderr: '',
          stdout: 'COPY 12\n',
        },
      })
      .mockResolvedValueOnce({
        source: { command: 'psql', args: [], exitCode: 0, signal: null, stderr: '', stdout: '' },
        target: {
          command: 'psql',
          args: [],
          exitCode: 0,
          signal: null,
          stderr: '',
          stdout: 'COPY 0\n',
        },
      });
    const service = new SpaceDataDbCopyService(processRunner as never);
    const onTableCopied = vi.fn();

    await expect(
      service.copySharedTables(
        [
          {
            table: 'record_history',
            sourceSql: 'COPY source history TO STDOUT',
            targetSql: 'COPY target history FROM STDIN',
            source: { command: psqlCommand, args: ['history-source'] },
            target: { command: psqlCommand, args: historyTargetArgs },
          },
          {
            table: 'record_trash',
            sourceSql: 'COPY source trash TO STDOUT',
            targetSql: 'COPY target trash FROM STDIN',
            source: { command: psqlCommand, args: ['trash-source'] },
            target: { command: psqlCommand, args: trashTargetArgs },
          },
        ],
        { timeoutMs: 10_000 },
        { onTableCopied }
      )
    ).resolves.toEqual([
      expect.objectContaining({ table: 'record_history', copiedRows: 12 }),
      expect.objectContaining({ table: 'record_trash', copiedRows: 0 }),
    ]);

    expect(processRunner.runPipeline).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ table: 'record_history' }),
      { timeoutMs: 10_000 }
    );
    expect(processRunner.runPipeline).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ table: 'record_trash' }),
      { timeoutMs: 10_000 }
    );
    expect(onTableCopied).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ table: 'record_history', copiedRows: 12 }),
      0,
      2
    );
    expect(onTableCopied).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ table: 'record_trash', copiedRows: 0 }),
      1,
      2
    );
  });

  it('executes postgres_fdw shared table inserts sequentially', async () => {
    processRunner.run
      .mockResolvedValueOnce({
        command: 'psql',
        args: [],
        exitCode: 0,
        signal: null,
        stderr: '',
        stdout: 'INSERT 0 7\n',
      })
      .mockResolvedValueOnce({
        command: 'psql',
        args: [],
        exitCode: 0,
        signal: null,
        stderr: '',
        stdout: 'INSERT 0 0\n',
      });
    const service = new SpaceDataDbCopyService(processRunner as never);
    const onTableCopied = vi.fn();

    await expect(
      service.copySharedTablesViaPostgresFdw(
        [
          {
            table: 'record_history',
            sql: 'fdw history',
            target: { command: 'psql', args: ['history-target'] },
          },
          {
            table: 'record_trash',
            sql: 'fdw trash',
            target: { command: 'psql', args: ['trash-target'] },
          },
        ],
        { timeoutMs: 10_000 },
        { onTableCopied }
      )
    ).resolves.toEqual([
      expect.objectContaining({
        strategy: 'postgres_fdw',
        table: 'record_history',
        copiedRows: 7,
      }),
      expect.objectContaining({
        strategy: 'postgres_fdw',
        table: 'record_trash',
        copiedRows: 0,
      }),
    ]);

    expect(processRunner.run).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ command: psqlCommand, args: historyTargetArgs }),
      { timeoutMs: 10_000 }
    );
    expect(processRunner.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ command: psqlCommand, args: trashTargetArgs }),
      { timeoutMs: 10_000 }
    );
    expect(onTableCopied).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ table: 'record_history', copiedRows: 7 }),
      0,
      2
    );
  });
});
