import { describe, expect, it } from 'vitest';
import {
  buildBaseSchemaDumpRestorePlan,
  buildBaseSchemaDumpStreamRestorePlan,
  buildBaseSchemaPgcopydbPlan,
  buildBaseSchemaRestorePlan,
  buildMigrationSharedTablePostgresFdwCopyPlans,
  buildMigrationSharedTablePsqlCopyPlans,
  buildSharedTablePostgresFdwCopyPlan,
  buildSharedTableCopyPlan,
  buildSharedTablePsqlCopyPlan,
  postgresToolUrl,
} from './space-data-db-copy-plan';

const sourceHost = 'source.example';
const targetHost = 'target.example';
const sourceUrl = `postgresql://${sourceHost}/teable`;
const targetUrl = `postgresql://${targetHost}/teable`;
const workDir = '/tmp/sdmjxxx';
const dumpFile = '/tmp/sdmjxxx/base-schemas.dump';
const noOwnerArg = '--no-owner';
const noAclArg = '--no-acl';
const exitOnErrorArg = '--exit-on-error';
const jobsArg = '--jobs';
const pgcopydbWorkDirectory = '/tmp/sdmjxxx/pgcopydb-base-schemas';
const pgcopydbFilterFile = '/tmp/sdmjxxx/pgcopydb-base-schemas.filter.ini';
const psqlCommandArgs = ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--command'];
const fdwSourceUrl =
  'postgresql://source_user:source_secret@source.example:15432/teable_source?sslmode=require';

describe('space data DB copy plan', () => {
  it('strips Prisma-only query params from URLs passed to PostgreSQL client tools', () => {
    expect(
      postgresToolUrl(
        'postgresql://teable:secret@127.0.0.1:5432/teable?schema=public&statement_cache_size=1&sslmode=require'
      )
    ).toBe('postgresql://teable:secret@127.0.0.1:5432/teable?sslmode=require');
  });

  it('percent-encodes user info for PostgreSQL client tool URIs', () => {
    expect(
      postgresToolUrl(
        'postgresql://user.name:pa%ss$word@target.example:5432/teable?schema=public&sslmode=require'
      )
    ).toBe('postgresql://user.name:pa%25ss%24word@target.example:5432/teable?sslmode=require');
  });

  it('does not double-encode already encoded PostgreSQL client tool user info', () => {
    expect(postgresToolUrl('postgresql://user%40name:pa%25ss%24word@target.example/teable')).toBe(
      'postgresql://user%40name:pa%25ss%24word@target.example/teable'
    );
  });

  it('maps the node-pg-only sslmode=no-verify to require for PostgreSQL client tools', () => {
    expect(
      postgresToolUrl(
        'postgresql://teable:secret@127.0.0.1:5432/teable?sslmode=no-verify&connect_timeout=60'
      )
    ).toBe('postgresql://teable:secret@127.0.0.1:5432/teable?sslmode=require&connect_timeout=60');
  });

  it('keeps libpq-native sslmode values untouched for PostgreSQL client tools', () => {
    expect(postgresToolUrl('postgresql://127.0.0.1:5432/teable?sslmode=disable')).toBe(
      'postgresql://127.0.0.1:5432/teable?sslmode=disable'
    );
    expect(postgresToolUrl('postgresql://127.0.0.1:5432/teable?sslmode=verify-full')).toBe(
      'postgresql://127.0.0.1:5432/teable?sslmode=verify-full'
    );
  });

  it('builds pg_dump and pg_restore spawn-array plans for base schemas', () => {
    const plan = buildBaseSchemaDumpRestorePlan({
      sourceUrl,
      targetUrl,
      schemaNames: ['bsebbb', 'bseaaa'],
      workDir,
      jobs: 4,
    });

    expect(plan.dumpFile).toBe(dumpFile);
    expect(plan.dump).toEqual({
      command: 'pg_dump',
      args: [
        '--format=custom',
        noOwnerArg,
        noAclArg,
        '--file',
        dumpFile,
        '--schema',
        '"bseaaa"',
        '--schema',
        '"bsebbb"',
        sourceUrl,
      ],
    });
    expect(plan.restore).toEqual({
      command: 'pg_restore',
      args: [
        noOwnerArg,
        noAclArg,
        exitOnErrorArg,
        jobsArg,
        '4',
        '--dbname',
        targetUrl,
        dumpFile,
      ],
    });
  });

  it('requires at least one schema for base schema copy planning', () => {
    expect(() =>
      buildBaseSchemaDumpRestorePlan({
        sourceUrl,
        targetUrl,
        schemaNames: [],
        workDir,
      })
    ).toThrow('At least one base schema');
  });

  it('builds streaming pg_dump to pg_restore plans for base schemas', () => {
    const plan = buildBaseSchemaDumpStreamRestorePlan({
      sourceUrl,
      targetUrl,
      schemaNames: ['bsebbb', 'bseaaa'],
    });

    expect(plan).toEqual({
      label: 'base-schemas',
      schemaNames: ['bseaaa', 'bsebbb'],
      source: {
        command: 'pg_dump',
        args: [
          '--format=custom',
          noOwnerArg,
          noAclArg,
          '--schema',
          '"bseaaa"',
          '--schema',
          '"bsebbb"',
          sourceUrl,
        ],
      },
      target: {
        command: 'pg_restore',
        args: [noOwnerArg, noAclArg, exitOnErrorArg, '--dbname', targetUrl],
      },
    });
  });

  it('adds a pg_restore use-list file when base schema restore needs filtered TOC entries', () => {
    const plan = buildBaseSchemaRestorePlan({
      targetUrl,
      dumpFile,
      jobs: 2,
      restoreListFile: '/tmp/sdmjxxx/base-schemas.restore.list',
    });

    expect(plan).toEqual({
      command: 'pg_restore',
      args: [
        noOwnerArg,
        noAclArg,
        exitOnErrorArg,
        jobsArg,
        '2',
        '--use-list',
        '/tmp/sdmjxxx/base-schemas.restore.list',
        '--dbname',
        targetUrl,
        dumpFile,
      ],
    });
  });

  it('uses PostgreSQL-tool-compatible URLs for physical copy commands', () => {
    const plan = buildBaseSchemaDumpRestorePlan({
      sourceUrl:
        'postgresql://source.example/teable?schema=public&statement_cache_size=1&sslmode=require',
      targetUrl:
        'postgresql://target.example/teable?schema=public&connection_limit=10&sslmode=require',
      schemaNames: ['bsexxx'],
      workDir,
    });

    expect(plan.dump.args.at(-1)).toBe('postgresql://source.example/teable?sslmode=require');
    expect(plan.dump.args).toContain('"bsexxx"');
    expect(plan.restore.args).toContain('postgresql://target.example/teable?sslmode=require');
  });

  it('uses percent-encoded PostgreSQL-tool-compatible URLs in physical copy commands', () => {
    const rawSourceUrl = 'postgresql://source_user:source%secret$@source.example/teable';
    const rawTargetUrl = 'postgresql://target_user:target%secret$@target.example/teable';
    const safeSourceUrl = 'postgresql://source_user:source%25secret%24@source.example/teable';
    const safeTargetUrl = 'postgresql://target_user:target%25secret%24@target.example/teable';

    const dumpRestorePlan = buildBaseSchemaDumpRestorePlan({
      sourceUrl: rawSourceUrl,
      targetUrl: rawTargetUrl,
      schemaNames: ['bsexxx'],
      workDir,
    });
    const streamPlan = buildBaseSchemaDumpStreamRestorePlan({
      sourceUrl: rawSourceUrl,
      targetUrl: rawTargetUrl,
      schemaNames: ['bsexxx'],
    });
    const psqlPlan = buildSharedTablePsqlCopyPlan({
      sourceUrl: rawSourceUrl,
      targetUrl: rawTargetUrl,
      sourceSchema: 'public',
      targetSchema: 'teable_meta_target',
      table: 'record_history',
      columns: ['id'],
      whereSql: `"table_id" = ANY(ARRAY['tblxxx']::text[])`,
    });
    const pgcopydbPlan = buildBaseSchemaPgcopydbPlan({
      sourceUrl: rawSourceUrl,
      targetUrl: rawTargetUrl,
      schemaNames: ['bsexxx'],
      workDir,
    });

    expect(dumpRestorePlan.dump.args.at(-1)).toBe(safeSourceUrl);
    expect(dumpRestorePlan.restore.args).toContain(safeTargetUrl);
    expect(streamPlan.source.args.at(-1)).toBe(safeSourceUrl);
    expect(streamPlan.target.args).toContain(safeTargetUrl);
    expect(psqlPlan.source.args.at(-1)).toBe(safeSourceUrl);
    expect(psqlPlan.target.args.at(-1)).toBe(safeTargetUrl);
    expect(pgcopydbPlan.copy.args).toContain(safeSourceUrl);
    expect(pgcopydbPlan.copy.args).toContain(safeTargetUrl);
  });

  it('builds an explicitly selected pgcopydb plan with a schema include filter', () => {
    const plan = buildBaseSchemaPgcopydbPlan({
      sourceUrl,
      targetUrl,
      schemaNames: ['bsebbb', 'bseaaa'],
      workDir,
      jobs: 3,
    });

    expect(plan.workDirectory).toBe(pgcopydbWorkDirectory);
    expect(plan.filterFile).toBe(pgcopydbFilterFile);
    expect(plan.filterFileContent).toBe('[include-only-schema]\n"bseaaa"\n"bsebbb"\n');
    expect(plan.copy).toEqual({
      command: 'pgcopydb',
      args: [
        'copy',
        'db',
        '--source',
        sourceUrl,
        '--target',
        targetUrl,
        '--dir',
        pgcopydbWorkDirectory,
        '--table-jobs',
        '3',
        '--index-jobs',
        '3',
        '--restore-jobs',
        '3',
        noOwnerArg,
        noAclArg,
        '--skip-large-objects',
        '--filters',
        pgcopydbFilterFile,
        '--fail-fast',
        '--restart',
      ],
    });
  });

  it('uses PostgreSQL-tool-compatible URLs for pgcopydb commands', () => {
    const plan = buildBaseSchemaPgcopydbPlan({
      sourceUrl: 'postgresql://source.example/teable?schema=public',
      targetUrl: 'postgresql://target.example/teable?statement_cache_size=1',
      schemaNames: ['bsexxx'],
      workDir,
    });

    expect(plan.copy.args).toContain('postgresql://source.example/teable');
    expect(plan.copy.args).toContain('postgresql://target.example/teable');
  });

  it('builds streaming COPY plans with explicit columns and scoped filters', () => {
    const plan = buildSharedTableCopyPlan({
      sourceSchema: 'public',
      targetSchema: 'teable_meta_target',
      table: 'record_history',
      columns: ['id', 'table_id', 'record_id', 'snapshot'],
      whereSql: '"table_id" = ANY($1::text[])',
      sourceBindings: [['tblxxx', 'tblyyy']],
    });

    expect(plan).toEqual({
      sourceSql:
        'COPY (SELECT "id", "table_id", "record_id", "snapshot" FROM "public"."record_history" WHERE "table_id" = ANY($1::text[])) TO STDOUT',
      sourceBindings: [['tblxxx', 'tblyyy']],
      targetSql:
        'COPY "teable_meta_target"."record_history" ("id", "table_id", "record_id", "snapshot") FROM STDIN',
    });
  });

  it('builds psql process plans for streaming shared-table COPY', () => {
    const plan = buildSharedTablePsqlCopyPlan({
      sourceUrl,
      targetUrl,
      sourceSchema: 'public',
      targetSchema: 'teable_meta_target',
      table: 'record_history',
      columns: ['id', 'table_id', 'record_id'],
      whereSql: `"table_id" = ANY(ARRAY['tblxxx']::text[])`,
    });

    expect(plan.table).toBe('record_history');
    expect(plan.sourceSql).toBe(
      `COPY (SELECT "id", "table_id", "record_id" FROM "public"."record_history" WHERE "table_id" = ANY(ARRAY['tblxxx']::text[])) TO STDOUT`
    );
    expect(plan.targetSql).toBe(
      'COPY "teable_meta_target"."record_history" ("id", "table_id", "record_id") FROM STDIN'
    );
    expect(plan.source).toEqual({
      command: 'psql',
      args: [...psqlCommandArgs, plan.sourceSql, sourceUrl],
    });
    expect(plan.target).toEqual({
      command: 'psql',
      args: [...psqlCommandArgs, plan.targetSql, targetUrl],
    });
  });

  it('uses PostgreSQL-tool-compatible URLs for psql shared-table copy commands', () => {
    const plan = buildSharedTablePsqlCopyPlan({
      sourceUrl: 'postgresql://source.example/teable?schema=public',
      targetUrl: 'postgresql://target.example/teable?statement_cache_size=1',
      sourceSchema: 'public',
      targetSchema: 'teable_meta_target',
      table: 'record_history',
      columns: ['id'],
      whereSql: `"table_id" = ANY(ARRAY['tblxxx']::text[])`,
    });

    expect(plan.source.args.at(-1)).toBe('postgresql://source.example/teable');
    expect(plan.target.args.at(-1)).toBe('postgresql://target.example/teable');
  });

  it('builds postgres_fdw plans for explicitly selected shared-table DB-to-DB inserts', () => {
    const plan = buildSharedTablePostgresFdwCopyPlan({
      sourceUrl: fdwSourceUrl,
      targetUrl,
      sourceSchema: 'public',
      targetSchema: 'teable_meta_target',
      table: 'record_history',
      columns: ['id', 'table_id', 'record_id'],
      whereSql: `"table_id" = ANY(ARRAY['tblxxx']::text[])`,
      fdwSchema: 'sdmjxxx_fdw_0',
      serverName: 'sdmjxxx_srv_0',
    });

    expect(plan.table).toBe('record_history');
    expect(plan.sql).toContain('CREATE EXTENSION IF NOT EXISTS postgres_fdw;');
    expect(plan.sql).toContain('CREATE SCHEMA "sdmjxxx_fdw_0";');
    expect(plan.sql).toContain(
      `CREATE SERVER "sdmjxxx_srv_0" FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host 'source.example', port '15432', dbname 'teable_source', sslmode 'require');`
    );
    expect(plan.sql).toContain(
      `CREATE USER MAPPING FOR CURRENT_USER SERVER "sdmjxxx_srv_0" OPTIONS (user 'source_user', password 'source_secret');`
    );
    expect(plan.sql).toContain(
      'IMPORT FOREIGN SCHEMA "public" LIMIT TO ("record_history") FROM SERVER "sdmjxxx_srv_0" INTO "sdmjxxx_fdw_0";'
    );
    expect(plan.sql).toContain(
      `INSERT INTO "teable_meta_target"."record_history" ("id", "table_id", "record_id") SELECT "id", "table_id", "record_id" FROM "sdmjxxx_fdw_0"."record_history" WHERE "table_id" = ANY(ARRAY['tblxxx']::text[]);`
    );
    expect(plan.sql).toContain('DROP SERVER "sdmjxxx_srv_0" CASCADE;');
    expect(plan.target).toEqual({
      command: 'psql',
      args: [...psqlCommandArgs, plan.sql, targetUrl],
    });
  });

  it('maps sslmode=no-verify to require inside postgres_fdw server options', () => {
    const plan = buildSharedTablePostgresFdwCopyPlan({
      sourceUrl:
        'postgresql://source_user:source_secret@source.example:15432/teable_source?sslmode=no-verify',
      targetUrl,
      sourceSchema: 'public',
      targetSchema: 'teable_meta_target',
      table: 'record_history',
      columns: ['id'],
      whereSql: `"table_id" = ANY(ARRAY['tblxxx']::text[])`,
      fdwSchema: 'sdmjxxx_fdw_0',
      serverName: 'sdmjxxx_srv_0',
    });

    expect(plan.sql).toContain(
      `CREATE SERVER "sdmjxxx_srv_0" FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host 'source.example', port '15432', dbname 'teable_source', sslmode 'require');`
    );
  });

  it('builds scoped psql COPY plans for all migration shared tables', () => {
    const plans = buildMigrationSharedTablePsqlCopyPlans({
      sourceUrl,
      targetUrl,
      sourceSchema: 'public',
      targetSchema: 'teable_meta_target',
      spaceId: "spc'x",
      baseIds: ['bsexxx', 'bseyyy'],
      tableIds: ['tblxxx', 'tblyyy'],
    });

    expect(plans.map((plan) => plan.table)).toEqual([
      'record_history',
      'table_trash',
      'record_trash',
      'computed_update_outbox',
      'computed_update_dead_letter',
      'computed_update_outbox_seed',
      'computed_update_pause_scope',
      '__undo_log',
    ]);
    expect(plans[0].sourceSql).toContain(`"table_id" = ANY(ARRAY['tblxxx', 'tblyyy']::text[])`);
    expect(plans[3].sourceSql).toContain(`"base_id" = ANY(ARRAY['bsexxx', 'bseyyy']::text[])`);
    expect(plans[5].sourceSql).toContain(
      'FROM "public"."computed_update_outbox" WHERE "base_id" = ANY'
    );
    expect(plans[6].sourceSql).toContain(`"scope_id" = ANY(ARRAY['spc''x']::text[])`);
    expect(plans[7].sourceSql).toContain(
      `split_part("table_name", '.', 1) = ANY(ARRAY['bsexxx', 'bseyyy']::text[])`
    );
    expect(plans.every((plan) => plan.source.args.includes(sourceUrl))).toBe(true);
    expect(plans.every((plan) => plan.target.args.includes(targetUrl))).toBe(true);
  });

  it('uses deleted-table shared scope only for shared rows that reference table_id directly', () => {
    const plans = buildMigrationSharedTablePsqlCopyPlans({
      sourceUrl,
      targetUrl,
      sourceSchema: 'public',
      targetSchema: 'teable_meta_target',
      spaceId: 'spcxxx',
      baseIds: ['bsexxx'],
      tableIds: ['tblactive'],
      sharedTableIds: ['tblactive', 'tbldeleted'],
    });

    expect(plans.find((plan) => plan.table === 'record_history')?.sourceSql).toContain(
      `"table_id" = ANY(ARRAY['tblactive', 'tbldeleted']::text[])`
    );
    expect(plans.find((plan) => plan.table === 'table_trash')?.sourceSql).toContain(
      `"table_id" = ANY(ARRAY['tblactive', 'tbldeleted']::text[])`
    );
    expect(plans.find((plan) => plan.table === 'record_trash')?.sourceSql).toContain(
      `"table_id" = ANY(ARRAY['tblactive', 'tbldeleted']::text[])`
    );
    expect(plans.find((plan) => plan.table === 'computed_update_outbox_seed')?.sourceSql).toContain(
      `"table_id" = ANY(ARRAY['tblactive']::text[])`
    );
    expect(plans.find((plan) => plan.table === 'computed_update_pause_scope')?.sourceSql).toContain(
      `"scope_id" = ANY(ARRAY['tblactive', 'tbldeleted']::text[])`
    );
  });

  it('builds scoped postgres_fdw plans for all migration shared tables', () => {
    const plans = buildMigrationSharedTablePostgresFdwCopyPlans({
      sourceUrl,
      targetUrl,
      sourceSchema: 'public',
      targetSchema: 'teable_meta_target',
      spaceId: "spc'x",
      baseIds: ['bsexxx', 'bseyyy'],
      tableIds: ['tblxxx', 'tblyyy'],
      fdwSchemaPrefix: 'sdmjxxx_fdw',
      serverNamePrefix: 'sdmjxxx_srv',
    });

    expect(plans.map((plan) => plan.table)).toEqual([
      'record_history',
      'table_trash',
      'record_trash',
      'computed_update_outbox',
      'computed_update_dead_letter',
      'computed_update_outbox_seed',
      'computed_update_pause_scope',
      '__undo_log',
    ]);
    expect(plans[0].sql).toContain('FROM "sdmjxxx_fdw_0"."record_history"');
    expect(plans[5].sql).toContain('FROM "sdmjxxx_fdw_5"."computed_update_outbox"');
    expect(plans[6].sql).toContain(`"scope_id" = ANY(ARRAY['spc''x']::text[])`);
    expect(plans.every((plan) => plan.target.args.includes(targetUrl))).toBe(true);
  });

  it('rejects unscoped shared table copy plans', () => {
    expect(() =>
      buildSharedTableCopyPlan({
        sourceSchema: 'public',
        targetSchema: 'teable_meta_target',
        table: 'record_history',
        columns: ['id'],
        whereSql: '',
      })
    ).toThrow('requires a scoped WHERE clause');
  });
});
