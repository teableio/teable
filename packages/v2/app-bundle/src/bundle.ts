import { strToU8, unzipSync, zipSync } from 'fflate';

import { checksumSection, computeBundleChecksum, sha256Hex } from './checksums';
import { AppBundleError, type AppBundleErrorCode } from './errors';
import {
  APP_BUNDLE_FORMAT_VERSION,
  appBundleManifestSchema,
  appBundleSeedPayloadSchema,
  appBundleStructureSchema,
  formatZodIssues,
  type AppBundleChecksums,
  type AppBundleManifest,
  type AppBundleSeedRecord,
  type AppBundleStructure,
} from './schema';

export interface IAppBundleSeedTable {
  readonly tableId: string;
  readonly records: ReadonlyArray<AppBundleSeedRecord>;
}

export interface IAppBundleMigration {
  readonly schemaVersion: number;
  readonly sql: string;
}

export interface IAppBundleContents {
  readonly manifest: AppBundleManifest;
  readonly structure: AppBundleStructure;
  readonly seed: ReadonlyArray<IAppBundleSeedTable>;
  readonly migrations: ReadonlyArray<IAppBundleMigration>;
  /** Section digests recomputed from the archive bytes. */
  readonly checksums: AppBundleChecksums;
  readonly bundleChecksum: string;
}

export interface IBuildAppBundleInput {
  readonly appId: string;
  readonly name: string;
  readonly version: string;
  readonly schemaVersion: number;
  readonly minRuntimeVersion?: string;
  readonly createdAt?: string;
  readonly structure: AppBundleStructure;
  readonly seed?: Readonly<Record<string, ReadonlyArray<AppBundleSeedRecord>>>;
  readonly migrations?: Readonly<Record<number, string>>;
}

const MANIFEST_PATH = 'manifest.json';
const STRUCTURE_PATH = 'structure.json';
const SEED_DIRECTORY = 'seed';
const MIGRATIONS_DIRECTORY = 'migrations';

const decodeUtf8 = (bytes: Uint8Array, path: string, code: AppBundleErrorCode): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new AppBundleError(code, `${path} is not valid UTF-8`, { cause: error });
  }
};

const parseJson = (text: string, path: string, code: AppBundleErrorCode): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new AppBundleError(code, `${path} is not valid JSON`, { cause: error });
  }
};

type BundleEntryKind =
  | { readonly kind: 'manifest' }
  | { readonly kind: 'structure' }
  | { readonly kind: 'seed'; readonly tableId: string }
  | { readonly kind: 'migration'; readonly schemaVersion: number };

const unexpectedFile = (path: string): AppBundleError =>
  new AppBundleError(
    'bundle.unexpected_file',
    `Unexpected bundle entry "${path}"; expected manifest.json, structure.json, seed/<tableId>.json, or migrations/<schemaVersion>.sql`
  );

const classifyEntry = (path: string): BundleEntryKind => {
  if (path === MANIFEST_PATH) return { kind: 'manifest' };
  if (path === STRUCTURE_PATH) return { kind: 'structure' };

  const segments = path.split('/');
  if (
    segments.some(
      (segment) =>
        segment.length === 0 || segment === '.' || segment === '..' || segment.includes('\\')
    )
  ) {
    throw unexpectedFile(path);
  }

  if (segments.length === 2 && segments[0] === SEED_DIRECTORY && segments[1]!.endsWith('.json')) {
    const tableId = segments[1]!.slice(0, -'.json'.length);
    if (!tableId) throw unexpectedFile(path);
    return { kind: 'seed', tableId };
  }

  if (
    segments.length === 2 &&
    segments[0] === MIGRATIONS_DIRECTORY &&
    segments[1]!.endsWith('.sql')
  ) {
    const rawVersion = segments[1]!.slice(0, -'.sql'.length);
    if (!/^[1-9]\d*$/.test(rawVersion)) throw unexpectedFile(path);
    return { kind: 'migration', schemaVersion: Number(rawVersion) };
  }

  throw unexpectedFile(path);
};

const readManifest = (bytes: Uint8Array): AppBundleManifest => {
  const text = decodeUtf8(bytes, MANIFEST_PATH, 'bundle.invalid_manifest');
  const raw = parseJson(text, MANIFEST_PATH, 'bundle.invalid_manifest');

  const formatVersion =
    raw !== null && typeof raw === 'object' && 'formatVersion' in raw
      ? raw.formatVersion
      : undefined;
  if (formatVersion !== APP_BUNDLE_FORMAT_VERSION) {
    throw new AppBundleError(
      'bundle.unsupported_format',
      `${MANIFEST_PATH} must declare formatVersion ${APP_BUNDLE_FORMAT_VERSION}`
    );
  }

  const parsed = appBundleManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppBundleError('bundle.invalid_manifest', formatZodIssues(parsed.error));
  }
  if (Number.isNaN(Date.parse(parsed.data.createdAt))) {
    throw new AppBundleError(
      'bundle.invalid_manifest',
      `manifest.createdAt is not a parseable date: ${parsed.data.createdAt}`
    );
  }
  return parsed.data;
};

const readStructure = (bytes: Uint8Array): AppBundleStructure => {
  const text = decodeUtf8(bytes, STRUCTURE_PATH, 'bundle.invalid_structure');
  const raw = parseJson(text, STRUCTURE_PATH, 'bundle.invalid_structure');
  const parsed = appBundleStructureSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppBundleError(
      'bundle.invalid_structure',
      `${STRUCTURE_PATH} is not a DotTea structure: ${formatZodIssues(parsed.error)}`
    );
  }
  return parsed.data;
};

const readSeed = (tableId: string, bytes: Uint8Array): IAppBundleSeedTable => {
  const path = `${SEED_DIRECTORY}/${tableId}.json`;
  const text = decodeUtf8(bytes, path, 'bundle.invalid_seed');
  const raw = parseJson(text, path, 'bundle.invalid_seed');
  const parsed = appBundleSeedPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppBundleError(
      'bundle.invalid_seed',
      `${path} must be an array of { fields: Record<string, unknown> }: ${formatZodIssues(parsed.error)}`
    );
  }
  return { tableId, records: parsed.data };
};

const validateSeedTables = (
  structure: AppBundleStructure,
  seed: ReadonlyArray<IAppBundleSeedTable>
): void => {
  const fieldIdsByTableId = new Map(
    structure.tables.flatMap((table) =>
      table.id
        ? [
            [
              table.id,
              new Set(table.fields.flatMap((field) => (field.id ? [field.id] : []))),
            ] as const,
          ]
        : []
    )
  );

  for (const table of seed) {
    const fieldIds = fieldIdsByTableId.get(table.tableId);
    if (!fieldIds) {
      throw new AppBundleError(
        'bundle.seed_table_unknown',
        `Seed file targets table "${table.tableId}" which is not declared with an id in structure.json`
      );
    }
    for (const record of table.records) {
      for (const key of Object.keys(record.fields)) {
        if (!fieldIds.has(key)) {
          throw new AppBundleError(
            'bundle.seed_field_unknown',
            `Seed record for table "${table.tableId}" uses field "${key}" which is not declared with that id in structure.json`
          );
        }
      }
    }
  }
};

/**
 * Builds a deterministic application bundle archive. Checksums are derived by
 * this function; callers cannot supply their own.
 */
export const buildAppBundle = async (input: IBuildAppBundleInput): Promise<Uint8Array> => {
  const structureResult = appBundleStructureSchema.safeParse(input.structure);
  if (!structureResult.success) {
    throw new AppBundleError(
      'bundle.invalid_structure',
      `structure is not a DotTea structure: ${formatZodIssues(structureResult.error)}`
    );
  }
  const structure = structureResult.data;

  const seed: IAppBundleSeedTable[] = Object.entries(input.seed ?? {})
    .map(([tableId, records]) => ({ tableId, records }))
    .sort((left, right) => (left.tableId < right.tableId ? -1 : 1));
  validateSeedTables(structure, seed);

  const migrations: IAppBundleMigration[] = Object.entries(input.migrations ?? {})
    .map(([rawVersion, sql]) => {
      if (!/^[1-9]\d*$/.test(rawVersion)) {
        throw new AppBundleError(
          'bundle.invalid_migration',
          `Migration key "${rawVersion}" must be a positive integer schema version`
        );
      }
      if (typeof sql !== 'string' || sql.trim().length === 0) {
        throw new AppBundleError(
          'bundle.invalid_migration',
          `Migration ${rawVersion} must contain SQL statements`
        );
      }
      return { schemaVersion: Number(rawVersion), sql };
    })
    .sort((left, right) => left.schemaVersion - right.schemaVersion);

  for (const migration of migrations) {
    if (migration.schemaVersion > input.schemaVersion) {
      throw new AppBundleError(
        'bundle.invalid_migration',
        `Migration ${migration.schemaVersion} is newer than the bundle schemaVersion ${input.schemaVersion}`
      );
    }
  }

  // Keep the caller's serialization (including key order) so the archive
  // contents and the manifest checksum match the payload they handed us.
  const structureBytes = strToU8(JSON.stringify(input.structure));
  const seedFiles = seed.map((table) => ({
    path: `${SEED_DIRECTORY}/${table.tableId}.json`,
    bytes: strToU8(JSON.stringify(table.records)),
  }));
  const migrationFiles = migrations.map((migration) => ({
    path: `${MIGRATIONS_DIRECTORY}/${migration.schemaVersion}.sql`,
    bytes: strToU8(migration.sql),
  }));

  const checksums: AppBundleChecksums = {
    structure: sha256Hex(structureBytes),
    seed: checksumSection(seedFiles),
    migrations: checksumSection(migrationFiles),
  };

  const createdAt = input.createdAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new AppBundleError(
      'bundle.invalid_manifest',
      `createdAt is not a parseable date: ${createdAt}`
    );
  }

  const manifestResult = appBundleManifestSchema.safeParse({
    formatVersion: APP_BUNDLE_FORMAT_VERSION,
    appId: input.appId,
    name: input.name,
    version: input.version,
    schemaVersion: input.schemaVersion,
    ...(input.minRuntimeVersion !== undefined
      ? { minRuntimeVersion: input.minRuntimeVersion }
      : {}),
    createdAt,
    checksums,
  });
  if (!manifestResult.success) {
    throw new AppBundleError('bundle.invalid_manifest', formatZodIssues(manifestResult.error));
  }

  const files: Record<string, Uint8Array> = {
    [MANIFEST_PATH]: strToU8(JSON.stringify(manifestResult.data)),
    [STRUCTURE_PATH]: structureBytes,
  };
  for (const file of [...seedFiles, ...migrationFiles]) {
    files[file.path] = file.bytes;
  }

  return zipSync(files, { level: 6 });
};

const readZip = (bytes: Uint8Array): Record<string, Uint8Array> => {
  try {
    return unzipSync(bytes);
  } catch (error) {
    throw new AppBundleError('bundle.invalid_zip', 'Bundle is not a readable zip archive', {
      cause: error,
    });
  }
};

/**
 * Reads and validates a bundle archive: entry names, format version, manifest
 * schema, DotTea structure shape, seed payloads, migration files, and all
 * section checksums.
 */
export const readAppBundle = async (bytes: Uint8Array): Promise<IAppBundleContents> => {
  const entries = readZip(bytes);

  let manifestBytes: Uint8Array | undefined;
  let structureBytes: Uint8Array | undefined;
  const seedEntries: Array<{ tableId: string; bytes: Uint8Array }> = [];
  const migrationEntries: Array<{ schemaVersion: number; bytes: Uint8Array }> = [];

  for (const [path, fileBytes] of Object.entries(entries)) {
    if (path.endsWith('/') && fileBytes.length === 0) {
      continue;
    }
    const classified = classifyEntry(path);
    switch (classified.kind) {
      case 'manifest':
        manifestBytes = fileBytes;
        break;
      case 'structure':
        structureBytes = fileBytes;
        break;
      case 'seed':
        seedEntries.push({ tableId: classified.tableId, bytes: fileBytes });
        break;
      case 'migration':
        migrationEntries.push({ schemaVersion: classified.schemaVersion, bytes: fileBytes });
        break;
    }
  }

  if (!manifestBytes) {
    throw new AppBundleError('bundle.missing_manifest', 'manifest.json is missing from the bundle');
  }
  if (!structureBytes) {
    throw new AppBundleError(
      'bundle.missing_structure',
      'structure.json is missing from the bundle'
    );
  }

  const manifest = readManifest(manifestBytes);
  const structure = readStructure(structureBytes);

  for (const migration of migrationEntries) {
    if (migration.schemaVersion > manifest.schemaVersion) {
      throw new AppBundleError(
        'bundle.invalid_migration',
        `Migration ${migration.schemaVersion} is newer than manifest.schemaVersion ${manifest.schemaVersion}`
      );
    }
  }

  const seed = seedEntries
    .map((entry) => readSeed(entry.tableId, entry.bytes))
    .sort((left, right) => (left.tableId < right.tableId ? -1 : 1));
  validateSeedTables(structure, seed);

  const migrations = migrationEntries
    .map((entry) => ({
      schemaVersion: entry.schemaVersion,
      sql: decodeUtf8(
        entry.bytes,
        `${MIGRATIONS_DIRECTORY}/${entry.schemaVersion}.sql`,
        'bundle.invalid_migration'
      ),
    }))
    .sort((left, right) => left.schemaVersion - right.schemaVersion);

  const checksums: AppBundleChecksums = {
    structure: sha256Hex(structureBytes),
    seed: checksumSection(
      seedEntries.map((entry) => ({
        path: `${SEED_DIRECTORY}/${entry.tableId}.json`,
        bytes: entry.bytes,
      }))
    ),
    migrations: checksumSection(
      migrationEntries.map((entry) => ({
        path: `${MIGRATIONS_DIRECTORY}/${entry.schemaVersion}.sql`,
        bytes: entry.bytes,
      }))
    ),
  };

  const mismatches: string[] = [];
  for (const scope of ['structure', 'seed', 'migrations'] as const) {
    if (checksums[scope] !== manifest.checksums[scope]) {
      mismatches.push(
        `${scope}: expected ${manifest.checksums[scope]}, actual ${checksums[scope]}`
      );
    }
  }
  if (mismatches.length > 0) {
    throw new AppBundleError(
      'bundle.checksum_mismatch',
      `Bundle checksum verification failed (${mismatches.join('; ')})`
    );
  }

  return {
    manifest,
    structure,
    seed,
    migrations,
    checksums,
    bundleChecksum: computeBundleChecksum(checksums),
  };
};
