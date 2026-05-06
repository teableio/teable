#!/usr/bin/env node
import pg from 'pg';

const { Client } = pg;

const DATA_PLANE_TABLES = [
  'computed_update_outbox',
  'computed_update_outbox_seed',
  'computed_update_dead_letter',
  'computed_update_pause_scope',
  'record_history',
  'table_trash',
  'record_trash',
  '__undo_log',
];

const META_PLANE_TABLES = ['base', 'table_meta', 'field'];

const usage = `Usage:
  node ./scripts/validate-dual-db-cutover.mjs --source <single-db-url> --meta <meta-db-url> --data <data-db-url> [--schema-prefix bse]

Environment fallback:
  DUAL_DB_SOURCE_URL
  DUAL_DB_TARGET_META_URL
  DUAL_DB_TARGET_DATA_URL
  DUAL_DB_SCHEMA_PREFIX
`;

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = value;
    index += 1;
  }
  return args;
};

const formatList = (items) => (items.length ? items.join(', ') : '(none)');

const diffSets = (source, target) => {
  const sourceSet = new Set(source);
  const targetSet = new Set(target);
  return {
    missingInTarget: source.filter((item) => !targetSet.has(item)),
    extraInTarget: target.filter((item) => !sourceSet.has(item)),
  };
};

const getSchemas = async (client, schemaPrefix) => {
  const result = await client.query(
    `
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name LIKE $1
      ORDER BY schema_name
    `,
    [`${schemaPrefix}%`]
  );
  return result.rows.map((row) => row.schema_name);
};

const getSchemaTableCounts = async (client, schemaPrefix) => {
  const result = await client.query(
    `
      SELECT table_schema AS schema_name, COUNT(*)::int AS table_count
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema LIKE $1
      GROUP BY table_schema
      ORDER BY table_schema
    `,
    [`${schemaPrefix}%`]
  );
  return new Map(result.rows.map((row) => [row.schema_name, Number(row.table_count)]));
};

const getTableCount = async (client, tableName) => {
  const existsResult = await client.query(`SELECT to_regclass($1) AS relation_name`, [
    `public.${tableName}`,
  ]);
  if (!existsResult.rows[0]?.relation_name) {
    return null;
  }
  const result = await client.query(`SELECT COUNT(*)::bigint AS count FROM public."${tableName}"`);
  return Number(result.rows[0]?.count ?? 0);
};

const getTableCounts = async (client, tableNames) => {
  const entries = await Promise.all(
    tableNames.map(async (tableName) => [tableName, await getTableCount(client, tableName)])
  );
  return new Map(entries);
};

const getFunctionExists = async (client, functionName) => {
  const result = await client.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = $1
      ) AS exists
    `,
    [functionName]
  );
  return Boolean(result.rows[0]?.exists);
};

const compareCountMaps = (source, target) => {
  const mismatches = [];
  const keys = new Set([...source.keys(), ...target.keys()]);
  for (const key of [...keys].sort()) {
    const sourceCount = source.get(key) ?? null;
    const targetCount = target.get(key) ?? null;
    if (sourceCount !== targetCount) {
      mismatches.push({ key, sourceCount, targetCount });
    }
  }
  return mismatches;
};

const logSection = (title) => {
  console.log(`\n[${title}]`);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const sourceUrl = args.source ?? process.env.DUAL_DB_SOURCE_URL;
  const metaUrl = args.meta ?? process.env.DUAL_DB_TARGET_META_URL;
  const dataUrl = args.data ?? process.env.DUAL_DB_TARGET_DATA_URL;
  const schemaPrefix = args['schema-prefix'] ?? process.env.DUAL_DB_SCHEMA_PREFIX ?? 'bse';

  if (!sourceUrl || !metaUrl || !dataUrl) {
    console.error(usage);
    throw new Error('Missing one or more required database urls');
  }

  const sourceClient = new Client({ connectionString: sourceUrl });
  const metaClient = new Client({ connectionString: metaUrl });
  const dataClient = new Client({ connectionString: dataUrl });

  await Promise.all([sourceClient.connect(), metaClient.connect(), dataClient.connect()]);

  try {
    const [sourceSchemas, targetSchemas, sourceSchemaTableCounts, targetSchemaTableCounts] =
      await Promise.all([
        getSchemas(sourceClient, schemaPrefix),
        getSchemas(dataClient, schemaPrefix),
        getSchemaTableCounts(sourceClient, schemaPrefix),
        getSchemaTableCounts(dataClient, schemaPrefix),
      ]);

    const schemaDiff = diffSets(sourceSchemas, targetSchemas);
    const schemaTableCountDiffs = compareCountMaps(sourceSchemaTableCounts, targetSchemaTableCounts);

    const [sourceDataCounts, targetDataCounts, sourceMetaCounts, targetMetaCounts, undoFunctionExists] =
      await Promise.all([
        getTableCounts(sourceClient, DATA_PLANE_TABLES),
        getTableCounts(dataClient, DATA_PLANE_TABLES),
        getTableCounts(sourceClient, META_PLANE_TABLES),
        getTableCounts(metaClient, META_PLANE_TABLES),
        getFunctionExists(dataClient, '__teable_capture_undo_row'),
      ]);

    const dataCountDiffs = compareCountMaps(sourceDataCounts, targetDataCounts);
    const metaCountDiffs = compareCountMaps(sourceMetaCounts, targetMetaCounts);

    logSection('Schema Summary');
    console.log(`source ${schemaPrefix}* schemas: ${sourceSchemas.length}`);
    console.log(`target ${schemaPrefix}* schemas: ${targetSchemas.length}`);
    console.log(`missing in target: ${formatList(schemaDiff.missingInTarget)}`);
    console.log(`extra in target: ${formatList(schemaDiff.extraInTarget)}`);

    logSection('Per-Schema Table Count');
    if (!schemaTableCountDiffs.length) {
      console.log('all matched');
    } else {
      for (const diff of schemaTableCountDiffs.slice(0, 20)) {
        console.log(
          `${diff.key}: source=${String(diff.sourceCount ?? 'missing')} target=${String(diff.targetCount ?? 'missing')}`
        );
      }
      if (schemaTableCountDiffs.length > 20) {
        console.log(`... ${schemaTableCountDiffs.length - 20} more mismatches`);
      }
    }

    logSection('Meta Table Row Count');
    if (!metaCountDiffs.length) {
      console.log('all matched');
    } else {
      for (const diff of metaCountDiffs) {
        console.log(
          `${diff.key}: source=${String(diff.sourceCount ?? 'missing')} target=${String(diff.targetCount ?? 'missing')}`
        );
      }
    }

    logSection('Data-Plane Table Row Count');
    if (!dataCountDiffs.length) {
      console.log('all matched');
    } else {
      for (const diff of dataCountDiffs) {
        console.log(
          `${diff.key}: source=${String(diff.sourceCount ?? 'missing')} target=${String(diff.targetCount ?? 'missing')}`
        );
      }
    }

    logSection('Data-Plane Function');
    console.log(
      `public.__teable_capture_undo_row: ${undoFunctionExists ? 'present on target data db' : 'missing on target data db'}`
    );

    const hasMismatch =
      schemaDiff.missingInTarget.length > 0 ||
      schemaDiff.extraInTarget.length > 0 ||
      schemaTableCountDiffs.length > 0 ||
      metaCountDiffs.length > 0 ||
      dataCountDiffs.length > 0 ||
      !undoFunctionExists;

    if (hasMismatch) {
      process.exitCode = 1;
      console.error('\nDual-db cutover validation failed.');
      return;
    }

    console.log('\nDual-db cutover validation passed.');
  } finally {
    await Promise.allSettled([sourceClient.end(), metaClient.end(), dataClient.end()]);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
