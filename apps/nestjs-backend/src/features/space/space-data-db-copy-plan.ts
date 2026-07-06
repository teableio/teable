import path from 'path';

export type ISpaceDataDbProcessPlan = {
  command: string;
  args: string[];
};

export type ISpaceDataDbProcessPipelinePlan = {
  source: ISpaceDataDbProcessPlan;
  target: ISpaceDataDbProcessPlan;
  label?: string;
};

export type ISpaceDataDbDumpRestorePlan = {
  dumpFile: string;
  dump: ISpaceDataDbProcessPlan;
  restoreList?: ISpaceDataDbProcessPlan;
  restoreListFile?: string;
  restore: ISpaceDataDbProcessPlan;
};

export type ISpaceDataDbDumpStreamRestorePlan = ISpaceDataDbProcessPipelinePlan & {
  schemaNames: string[];
};

export type ISpaceDataDbPgcopydbPlan = {
  workDirectory: string;
  filterFile: string;
  filterFileContent: string;
  copy: ISpaceDataDbProcessPlan;
};

export type ISharedTableCopyPlan = {
  sourceSql: string;
  sourceBindings: unknown[];
  targetSql: string;
};

export type ISharedTablePsqlCopyPlan = ISpaceDataDbProcessPipelinePlan & {
  table: string;
  sourceSql: string;
  targetSql: string;
};

export type ISharedTablePostgresFdwCopyPlan = {
  table: string;
  sql: string;
  target: ISpaceDataDbProcessPlan;
};

const quoteIdent = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

const qualify = (schema: string, table: string) => `${quoteIdent(schema)}.${quoteIdent(table)}`;

const normalizeJobs = (jobs?: number) => Math.max(1, Math.floor(jobs ?? 1));

const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
const noOwnerArg = '--no-owner';
const noAclArg = '--no-acl';
const exitOnErrorArg = '--exit-on-error';
const jobsArg = '--jobs';
const pgcopydbBaseSchemasDir = 'pgcopydb-base-schemas';
const pgcopydbFilterFileName = 'pgcopydb-base-schemas.filter.ini';
const includeOnlySchemaSection = '[include-only-schema]';
const prismaOnlyPostgresUrlParams = [
  'schema',
  'statement_cache_size',
  'connection_limit',
  'pool_timeout',
  'pgbouncer',
] as const;

// node-pg treats `sslmode=require` as full CA verification, so self-signed targets must use
// its non-standard `no-verify` value. libpq-based consumers (pg_dump/pg_restore/psql/pgcopydb
// and postgres_fdw server options) reject `no-verify`; their spelling of the same semantics
// (encrypt without CA verification) is `require`.
const libpqSslMode = (sslmode: string) => (sslmode === 'no-verify' ? 'require' : sslmode);

const textArray = (values: string[]) =>
  values.length ? `ARRAY[${values.map(literal).join(', ')}]::text[]` : 'ARRAY[]::text[]';

const textArrayPredicate = (column: string, values: string[]) =>
  `${quoteIdent(column)} = ANY(${textArray(values)})`;

const decodePostgresToolUserInfoComponent = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    const escapedInvalidPercent = value.replace(/%(?![0-9a-f]{2})/gi, '%25');
    try {
      return decodeURIComponent(escapedInvalidPercent);
    } catch {
      return value;
    }
  }
};

const encodePostgresToolUserInfoComponent = (value: string) =>
  encodeURIComponent(decodePostgresToolUserInfoComponent(value));

const postgresToolUserInfo = (parsed: URL) => {
  if (!parsed.username) {
    return '';
  }
  const username = encodePostgresToolUserInfoComponent(parsed.username);
  const password = parsed.password
    ? `:${encodePostgresToolUserInfoComponent(parsed.password)}`
    : '';
  return `${username}${password}@`;
};

export const postgresToolUrl = (url: string) => {
  const parsed = new URL(url);
  for (const param of prismaOnlyPostgresUrlParams) {
    parsed.searchParams.delete(param);
  }
  const sslmode = parsed.searchParams.get('sslmode');
  if (sslmode) {
    parsed.searchParams.set('sslmode', libpqSslMode(sslmode));
  }
  return `${parsed.protocol}//${postgresToolUserInfo(parsed)}${parsed.host}${parsed.pathname}${
    parsed.search
  }${parsed.hash}`;
};

export const buildBaseSchemaRestoreListPlan = (dumpFile: string): ISpaceDataDbProcessPlan => ({
  command: 'pg_restore',
  args: ['--list', dumpFile],
});

export const buildBaseSchemaRestorePlan = (input: {
  targetUrl: string;
  dumpFile: string;
  jobs?: number;
  restoreListFile?: string;
}): ISpaceDataDbProcessPlan => {
  const jobs = String(normalizeJobs(input.jobs));
  const targetUrl = postgresToolUrl(input.targetUrl);
  return {
    command: 'pg_restore',
    args: [
      noOwnerArg,
      noAclArg,
      exitOnErrorArg,
      jobsArg,
      jobs,
      ...(input.restoreListFile ? ['--use-list', input.restoreListFile] : []),
      '--dbname',
      targetUrl,
      input.dumpFile,
    ],
  };
};

const psqlArgs = (url: string, command: string) => [
  '--no-psqlrc',
  '--set',
  'ON_ERROR_STOP=1',
  '--command',
  command,
  postgresToolUrl(url),
];

const parsePostgresUrl = (url: string) => {
  const parsed = new URL(url);
  const dbname = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!dbname) {
    throw new Error('Source PostgreSQL URL must include a database name for postgres_fdw copy');
  }

  const sslmode = parsed.searchParams.get('sslmode');
  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    dbname,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    sslmode: sslmode ? libpqSslMode(sslmode) : undefined,
  };
};

const fdwOptions = (options: Record<string, string | undefined>) =>
  Object.entries(options)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${key} ${literal(value)}`)
    .join(', ');

export const buildBaseSchemaDumpRestorePlan = (input: {
  sourceUrl: string;
  targetUrl: string;
  schemaNames: string[];
  workDir: string;
  jobs?: number;
}): ISpaceDataDbDumpRestorePlan => {
  const schemaNames = [...input.schemaNames].sort();
  if (!schemaNames.length) {
    throw new Error('At least one base schema is required for pg_dump planning');
  }

  const dumpFile = path.join(input.workDir, 'base-schemas.dump');
  const schemaArgs = schemaNames.flatMap((schemaName) => ['--schema', quoteIdent(schemaName)]);
  const sourceUrl = postgresToolUrl(input.sourceUrl);
  const targetUrl = postgresToolUrl(input.targetUrl);

  return {
    dumpFile,
    dump: {
      command: 'pg_dump',
      args: ['--format=custom', noOwnerArg, noAclArg, '--file', dumpFile, ...schemaArgs, sourceUrl],
    },
    restore: buildBaseSchemaRestorePlan({
      targetUrl,
      dumpFile,
      jobs: input.jobs,
    }),
  };
};

export const buildBaseSchemaDumpStreamRestorePlan = (input: {
  sourceUrl: string;
  targetUrl: string;
  schemaNames: string[];
}): ISpaceDataDbDumpStreamRestorePlan => {
  const schemaNames = [...input.schemaNames].sort();
  if (!schemaNames.length) {
    throw new Error('At least one base schema is required for pg_dump planning');
  }

  const schemaArgs = schemaNames.flatMap((schemaName) => ['--schema', quoteIdent(schemaName)]);
  const sourceUrl = postgresToolUrl(input.sourceUrl);
  const targetUrl = postgresToolUrl(input.targetUrl);

  return {
    label: 'base-schemas',
    schemaNames,
    source: {
      command: 'pg_dump',
      args: ['--format=custom', noOwnerArg, noAclArg, ...schemaArgs, sourceUrl],
    },
    target: {
      command: 'pg_restore',
      args: [noOwnerArg, noAclArg, exitOnErrorArg, '--dbname', targetUrl],
    },
  };
};

export const buildBaseSchemaPgcopydbPlan = (input: {
  sourceUrl: string;
  targetUrl: string;
  schemaNames: string[];
  workDir: string;
  jobs?: number;
}): ISpaceDataDbPgcopydbPlan => {
  const schemaNames = [...input.schemaNames].sort();
  if (!schemaNames.length) {
    throw new Error('At least one base schema is required for pgcopydb planning');
  }

  const jobs = String(normalizeJobs(input.jobs));
  const workDirectory = path.join(input.workDir, pgcopydbBaseSchemasDir);
  const filterFile = path.join(input.workDir, pgcopydbFilterFileName);
  const filterFileContent = [includeOnlySchemaSection, ...schemaNames.map(quoteIdent), ''].join(
    '\n'
  );

  return {
    workDirectory,
    filterFile,
    filterFileContent,
    copy: {
      command: 'pgcopydb',
      args: [
        'copy',
        'db',
        '--source',
        postgresToolUrl(input.sourceUrl),
        '--target',
        postgresToolUrl(input.targetUrl),
        '--dir',
        workDirectory,
        '--table-jobs',
        jobs,
        '--index-jobs',
        jobs,
        '--restore-jobs',
        jobs,
        noOwnerArg,
        noAclArg,
        '--skip-large-objects',
        '--filters',
        filterFile,
        '--fail-fast',
        '--restart',
      ],
    },
  };
};

export const buildSharedTableCopyPlan = (input: {
  sourceSchema: string;
  targetSchema: string;
  table: string;
  columns: string[];
  whereSql: string;
  sourceBindings?: unknown[];
}): ISharedTableCopyPlan => {
  if (!input.columns.length) {
    throw new Error(`Shared table ${input.table} requires an explicit column list`);
  }
  if (!input.whereSql.trim()) {
    throw new Error(`Shared table ${input.table} requires a scoped WHERE clause`);
  }

  const columns = input.columns.map(quoteIdent).join(', ');
  return {
    sourceSql: `COPY (SELECT ${columns} FROM ${qualify(input.sourceSchema, input.table)} WHERE ${
      input.whereSql
    }) TO STDOUT`,
    sourceBindings: input.sourceBindings ?? [],
    targetSql: `COPY ${qualify(input.targetSchema, input.table)} (${columns}) FROM STDIN`,
  };
};

export const buildSharedTablePsqlCopyPlan = (input: {
  sourceUrl: string;
  targetUrl: string;
  sourceSchema: string;
  targetSchema: string;
  table: string;
  columns: string[];
  whereSql: string;
}): ISharedTablePsqlCopyPlan => {
  const plan = buildSharedTableCopyPlan(input);
  return {
    table: input.table,
    label: `shared-table:${input.table}`,
    sourceSql: plan.sourceSql,
    targetSql: plan.targetSql,
    source: {
      command: 'psql',
      args: psqlArgs(input.sourceUrl, plan.sourceSql),
    },
    target: {
      command: 'psql',
      args: psqlArgs(input.targetUrl, plan.targetSql),
    },
  };
};

export const buildSharedTablePostgresFdwCopyPlan = (input: {
  sourceUrl: string;
  targetUrl: string;
  sourceSchema: string;
  targetSchema: string;
  table: string;
  columns: string[];
  whereSql: string;
  fdwSchema: string;
  serverName: string;
}): ISharedTablePostgresFdwCopyPlan => {
  if (!input.columns.length) {
    throw new Error(`Shared table ${input.table} requires an explicit column list`);
  }
  if (!input.whereSql.trim()) {
    throw new Error(`Shared table ${input.table} requires a scoped WHERE clause`);
  }

  const source = parsePostgresUrl(input.sourceUrl);
  const columns = input.columns.map(quoteIdent).join(', ');
  const serverOptions = fdwOptions({
    host: source.host,
    port: source.port,
    dbname: source.dbname,
    sslmode: source.sslmode,
  });
  const userMappingOptions = fdwOptions({
    user: source.user,
    password: source.password,
  });
  const importLimit = quoteIdent(input.table);
  const targetTable = qualify(input.targetSchema, input.table);
  const foreignTable = qualify(input.fdwSchema, input.table);

  const sql = [
    'BEGIN',
    'CREATE EXTENSION IF NOT EXISTS postgres_fdw',
    `CREATE SCHEMA ${quoteIdent(input.fdwSchema)}`,
    `CREATE SERVER ${quoteIdent(
      input.serverName
    )} FOREIGN DATA WRAPPER postgres_fdw OPTIONS (${serverOptions})`,
    userMappingOptions
      ? `CREATE USER MAPPING FOR CURRENT_USER SERVER ${quoteIdent(
          input.serverName
        )} OPTIONS (${userMappingOptions})`
      : '',
    `IMPORT FOREIGN SCHEMA ${quoteIdent(input.sourceSchema)} LIMIT TO (${importLimit}) FROM SERVER ${quoteIdent(
      input.serverName
    )} INTO ${quoteIdent(input.fdwSchema)}`,
    `INSERT INTO ${targetTable} (${columns}) SELECT ${columns} FROM ${foreignTable} WHERE ${input.whereSql}`,
    `DROP SERVER ${quoteIdent(input.serverName)} CASCADE`,
    `DROP SCHEMA ${quoteIdent(input.fdwSchema)} CASCADE`,
    'COMMIT',
  ]
    .filter(Boolean)
    .map((statement) => `${statement};`)
    .join('\n');

  return {
    table: input.table,
    sql,
    target: {
      command: 'psql',
      args: psqlArgs(input.targetUrl, sql),
    },
  };
};

const computedOutboxColumns = [
  'id',
  'base_id',
  'seed_table_id',
  'seed_record_ids',
  'change_type',
  'steps',
  'edges',
  'status',
  'attempts',
  'max_attempts',
  'next_run_at',
  'locked_at',
  'locked_by',
  'last_error',
  'estimated_complexity',
  'plan_hash',
  'dirty_stats',
  'run_id',
  'origin_run_ids',
  'run_total_steps',
  'run_completed_steps_before',
  'affected_table_ids',
  'affected_field_ids',
  'sync_max_level',
  'created_at',
  'updated_at',
];

const recordHistoryColumns = [
  'id',
  'table_id',
  'record_id',
  'field_id',
  'before',
  'after',
  'created_time',
  'created_by',
];

const buildMigrationSharedTableDefinitions = (input: {
  sourceSchema: string;
  spaceId: string;
  spaceIds?: string[];
  baseIds: string[];
  tableIds: string[];
  sharedTableIds?: string[];
}) => {
  const sharedTableIds = input.sharedTableIds?.length ? input.sharedTableIds : input.tableIds;
  const tablePredicate = textArrayPredicate('table_id', sharedTableIds);
  const basePredicate = textArrayPredicate('base_id', input.baseIds);
  const spaceIds = input.spaceIds?.length ? input.spaceIds : [input.spaceId];
  const outboxSeedPredicate = [
    textArrayPredicate('table_id', input.tableIds),
    `"task_id" IN (SELECT "id" FROM ${qualify(
      input.sourceSchema,
      'computed_update_outbox'
    )} WHERE ${basePredicate})`,
  ].join(' AND ');
  const pauseScopePredicate = [
    `("scope_type" = 'space' AND "scope_id" = ANY(${textArray(spaceIds)}))`,
    `("scope_type" = 'base' AND "scope_id" = ANY(${textArray(input.baseIds)}))`,
    `("scope_type" = 'table' AND "scope_id" = ANY(${textArray(sharedTableIds)}))`,
  ].join(' OR ');
  const undoPredicate = `split_part("table_name", '.', 1) = ANY(${textArray(input.baseIds)})`;

  return [
    {
      table: 'record_history',
      columns: recordHistoryColumns,
      whereSql: tablePredicate,
    },
    {
      table: 'table_trash',
      columns: ['id', 'table_id', 'resource_type', 'snapshot', 'created_time', 'created_by'],
      whereSql: tablePredicate,
    },
    {
      table: 'record_trash',
      columns: ['id', 'table_id', 'record_id', 'snapshot', 'created_time', 'created_by'],
      whereSql: tablePredicate,
    },
    {
      table: 'computed_update_outbox',
      columns: computedOutboxColumns,
      whereSql: basePredicate,
    },
    {
      table: 'computed_update_dead_letter',
      columns: [...computedOutboxColumns, 'trace_data', 'failed_at'],
      whereSql: basePredicate,
    },
    {
      table: 'computed_update_outbox_seed',
      columns: ['id', 'task_id', 'table_id', 'record_id'],
      whereSql: outboxSeedPredicate,
    },
    {
      table: 'computed_update_pause_scope',
      columns: [
        'id',
        'scope_type',
        'scope_id',
        'paused_at',
        'paused_by',
        'resume_at',
        'reason',
        'updated_at',
        'updated_by',
      ],
      whereSql: pauseScopePredicate,
    },
    {
      table: '__undo_log',
      columns: [
        'id',
        'batch_id',
        'operation',
        'table_name',
        'record_id',
        'old_row',
        'new_row',
        'created_at',
      ],
      whereSql: undoPredicate,
    },
  ];
};

export const buildMigrationSharedTablePsqlCopyPlans = (input: {
  sourceUrl: string;
  targetUrl: string;
  sourceSchema: string;
  targetSchema: string;
  spaceId: string;
  spaceIds?: string[];
  baseIds: string[];
  tableIds: string[];
  sharedTableIds?: string[];
}): ISharedTablePsqlCopyPlan[] => {
  const shared = buildMigrationSharedTableDefinitions(input);

  return shared.map((item) =>
    buildSharedTablePsqlCopyPlan({
      sourceUrl: input.sourceUrl,
      targetUrl: input.targetUrl,
      sourceSchema: input.sourceSchema,
      targetSchema: input.targetSchema,
      table: item.table,
      columns: item.columns,
      whereSql: item.whereSql,
    })
  );
};

export const buildMigrationSharedTablePostgresFdwCopyPlans = (input: {
  sourceUrl: string;
  targetUrl: string;
  sourceSchema: string;
  targetSchema: string;
  spaceId: string;
  spaceIds?: string[];
  baseIds: string[];
  tableIds: string[];
  sharedTableIds?: string[];
  fdwSchemaPrefix: string;
  serverNamePrefix: string;
}): ISharedTablePostgresFdwCopyPlan[] => {
  const shared = buildMigrationSharedTableDefinitions(input);

  return shared.map((_item, index) => {
    const fdwSchema = `${input.fdwSchemaPrefix}_${index}`;
    const item = buildMigrationSharedTableDefinitions({ ...input, sourceSchema: fdwSchema })[index];
    return buildSharedTablePostgresFdwCopyPlan({
      sourceUrl: input.sourceUrl,
      targetUrl: input.targetUrl,
      sourceSchema: input.sourceSchema,
      targetSchema: input.targetSchema,
      table: item.table,
      columns: item.columns,
      whereSql: item.whereSql,
      fdwSchema,
      serverName: `${input.serverNamePrefix}_${index}`,
    });
  });
};
