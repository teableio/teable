import { mkdir, statfs as nodeStatfs } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { getMetaDatabaseUrl } from '@teable/db-data-prisma';
import { PrismaService, ProvisionState, type Prisma } from '@teable/db-main-prisma';
import type {
  IDataDbMigrationJobStatusVo,
  IDataDbPreflightRo,
  IDataDbPreflightVo,
} from '@teable/openapi';
import { Queue } from 'bullmq';
import { CustomHttpException } from '../../custom.exception';
import {
  DataDbClientManager,
  type IResolvedDataDatabase,
} from '../../global/data-db-client-manager.service';
import { BASE_IMPORT_CSV_QUEUE } from '../base/base-import-processor/base-import-csv.processor';
import { BASE_IMPORT_JUNCTION_CSV_QUEUE } from '../base/base-import-processor/base-import-junction.processor';
import { TABLE_IMPORT_CSV_CHUNK_QUEUE } from '../import/open-api/import-csv-chunk.processor';
import { TABLE_IMPORT_CSV_QUEUE } from '../import/open-api/import-csv.processor';
import { DataDbBaselineService } from './data-db-baseline.service';
import { resolveDataDbInternalSchema } from './data-db-internal-schema';
import {
  DATA_DB_PREFLIGHT_CLIENT_FACTORY,
  dataDbKnexClientFactory,
  fingerprintDatabaseUrl,
  fingerprintDataDbConnection,
  getDatabaseUrlDisplayParts,
  type IDataDbPreflightClient,
  type IDataDbPreflightClientFactory,
  type IDataDbPreflightTransaction,
  DataDbPreflightService,
} from './data-db-preflight.service';
import { decryptDataDbUrl, encryptDataDbUrl } from './data-db-url-secret';
import {
  buildMigrationSharedTablePostgresFdwCopyPlans,
  buildMigrationSharedTablePsqlCopyPlans,
} from './space-data-db-copy-plan';
import {
  postgresCopyToolsForStrategy,
  SpaceDataDbCopyService,
  type ISpaceDataDbBaseSchemaCopyResult,
  type ISpaceDataDbBaseSchemaCopyStrategy,
  type ISpaceDataDbExcludedForeignKey,
  type ISpaceDataDbPostgresFdwSharedTableCopyResult,
  type ISpaceDataDbSharedTableCopyStrategy,
  type ISpaceDataDbSharedTableCopyResult,
} from './space-data-db-copy.service';
import {
  buildSpaceDataDbMigrationPercent,
  isTerminalSpaceDataDbMigrationPhase,
  SpaceDataDbMigrationProgressTracker,
  spaceDataDbMigrationStages,
  type ISpaceDataDbMigrationProgressDetail,
  type ISpaceDataDbMigrationStage,
  type ISpaceDataDbMigrationStageKey,
} from './space-data-db-migration-progress';
import {
  activeSpaceDataDbMigrationStates,
  cancelableSpaceDataDbMigrationStates,
  migrateSpaceTargetMode,
  spaceDataDbBackgroundWriterDrainTimeoutErrorCode,
  spaceDataDbComputedDrainTimeoutErrorCode,
  spaceDataDbInventoryChangedErrorCode,
  spaceDataDbLargeMigrationConfirmationRequiredErrorCode,
  spaceDataDbMigrationCanceledErrorCode,
  spaceDataDbMigrationActiveErrorCode,
  spaceDataDbMigrationCancelConflictErrorCode,
  spaceDataDbPostgresToolUnavailableErrorCode,
  spaceDataDbRelatedSpacesRequiredErrorCode,
  spaceDataDbRollbackUnsafeErrorCode,
  spaceDataDbSchemaOperationDrainTimeoutErrorCode,
  spaceDataDbStaleActiveJobErrorCode,
  spaceDataDbTargetCleanupFailedErrorCode,
  spaceDataDbTargetDiskInsufficientErrorCode,
  spaceDataDbTargetExtensionMissingErrorCode,
  spaceDataDbTargetConflictErrorCode,
  spaceDataDbTempDiskInsufficientErrorCode,
  spaceDataDbValidationMismatchErrorCode,
} from './space-data-db-migration.constants';
import {
  SpaceDataDbProcessCanceledError,
  SpaceDataDbProcessError,
  SpaceDataDbProcessPipelineError,
  SpaceDataDbProcessPipelineCanceledError,
  type ISpaceDataDbProcessRunOptions,
} from './space-data-db-process-runner.service';
import {
  resolveSpaceDataDbRelatedSpaces,
  type ISpaceDataDbRelatedSpaces,
} from './space-data-db-related-spaces';

export const spaceDataDbStatfsToken = Symbol('SPACE_DATA_DB_STATFS');

export type ISpaceDataDbStatfs = typeof nodeStatfs;

type IPreparedMigrationTarget = {
  encryptedUrl: string;
  urlFingerprint: string;
  displayHost: string;
  displayDatabase: string;
  internalSchema: string;
  schemaVersion: string | null;
  capabilities: IDataDbPreflightVo['capabilities'];
};

type ISpaceDataDbPhysicalRelation = {
  schemaName: string;
  relationName: string;
  relationKind: string;
  totalBytes: number;
  estimatedRows: number | null;
};

type ISpaceDataDbPhysicalSchema = {
  schemaName: string;
  relations: ISpaceDataDbPhysicalRelation[];
  totalBytes: number;
  estimatedRows: number;
};

type ISpaceDataDbPostgresExtensionDependency = {
  extensionName: string;
  objectType: 'operator_class';
  schemaName: string;
  objectName: string;
  accessMethod: string;
  sourceObjects: string[];
};

type ISpaceDataDbProcessFailureResult = {
  command: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stderr?: string;
  stdout?: string;
};

type ISpaceDataDbProcessFailureStats =
  | {
      type: 'pipeline';
      message: string;
      result: {
        source: ISpaceDataDbProcessFailureResult;
        target: ISpaceDataDbProcessFailureResult;
      };
    }
  | {
      type: 'process';
      message: string;
      result: ISpaceDataDbProcessFailureResult;
    }
  | {
      type: 'unknown';
      message: string;
    };

type ISpaceDataDbInventorySourceDataDb = {
  mode: 'default' | 'byodb';
  cacheKey: string;
  connectionId: string | null;
  internalSchema: string | null;
  isMetaFallback: boolean;
};

type ISpaceDataDbInventoryTargetDataDb = {
  internalSchema: string;
};

type ISpaceDataDbInventoryRelatedSpaces = ISpaceDataDbRelatedSpaces;

type ISpaceDataDbInventory = {
  sourceDataDb: ISpaceDataDbInventorySourceDataDb;
  targetDataDb: ISpaceDataDbInventoryTargetDataDb;
  relatedSpaces: ISpaceDataDbInventoryRelatedSpaces;
  spaceIds: string[];
  copySpaceIds: string[];
  baseIds: string[];
  tableIds: string[];
  sharedTableIds: string[];
  relatedSharedTableIds: string[];
  dbTableNames: string[];
  physicalSchemas: ISpaceDataDbPhysicalSchema[];
  postgresExtensionDependencies: ISpaceDataDbPostgresExtensionDependency[];
  outOfScopeForeignKeys: ISpaceDataDbExcludedForeignKey[];
  estimatedTotalBytes: number;
  estimatedTotalRows: number;
};

type ITargetConflict = {
  object: string;
  count?: number;
};

type ITargetDiskCapacity = {
  checked: boolean;
  reason?: string;
  dataDirectory?: string;
  mountPath?: string;
  availableBytes?: number;
  totalBytes?: number;
  usedBytes?: number;
  checkedAt: string;
};

type IValidationMismatch = {
  object: string;
  reason: string;
  sourceCount?: number;
  targetCount?: number;
  sourceContentHash?: string | null;
  targetContentHash?: string | null;
  sourceKind?: string;
  targetKind?: string | null;
  sourceColumns?: IBaseRelationColumnSignature[];
  targetColumns?: IBaseRelationColumnSignature[];
  sourceIndexes?: IBaseRelationIndexSignature[];
  targetIndexes?: IBaseRelationIndexSignature[];
  sourceConstraints?: IBaseRelationConstraintSignature[];
  targetConstraints?: IBaseRelationConstraintSignature[];
  sourceTriggers?: IBaseRelationTriggerSignature[];
  targetTriggers?: IBaseRelationTriggerSignature[];
};

type IInventoryChangedMismatch = {
  object: string;
  reason: 'inventory_changed';
  expectedCount?: number;
  actualCount?: number;
  added?: string[];
  removed?: string[];
  expected?: unknown;
  actual?: unknown;
};

type IRowCountValidation = {
  object: string;
  sourceCount: number;
  targetCount: number;
  sourceContentHash?: string | null;
  targetContentHash?: string | null;
};

type IRelationScopedRow<T> = T & { schemaName: string; relationName: string };

type IRelationSignatureMaps = {
  columns: Map<string, IBaseRelationColumnSignature[]>;
  indexes: Map<string, IBaseRelationIndexSignature[]>;
  constraints: Map<string, IBaseRelationConstraintSignature[]>;
  triggers: Map<string, IBaseRelationTriggerSignature[]>;
};

type IBaseRelationRowValidationPlan = {
  key: string;
  sourceRelation: ISpaceDataDbPhysicalRelation;
  targetRelation: ISpaceDataDbPhysicalRelation;
  contentHashColumns?: IBaseRelationColumnSignature[];
};

type IValidationStats = {
  phase: 'validation_completed';
  progress: IMigrationProgressStats;
  targetSchemaVersion: { latest: string | null; exists: boolean };
  routeSmoke: IRouteSmokeStats;
  baseSchemas: IRowCountValidation[];
  sharedTables: IRowCountValidation[];
  undoFunction: { exists: boolean };
  warnings?: string[];
  mismatches?: IValidationMismatch[];
  sourceDelta?: {
    validationStartSeq: number | null;
    validationEndSeq: number | null;
  };
  switchOnCompletion?: boolean;
  switched?: boolean;
  switchedAt?: string;
  completedAt: string;
};

type IComputedDrainStats = {
  activeCount: number;
  reclaimableCount: number;
  oldestActiveLockedAt: string | null;
  checkedAt: string;
};

type IRouteSmokeStats = {
  ok: boolean;
  connectionId: string | null;
  internalSchema: string | null;
  cacheKey: string | null;
  isMetaFallback: boolean;
  error?: string;
};

type ISharedTableCopySummary = {
  strategy?: ISpaceDataDbSharedTableCopyStrategy;
  table: string;
  copiedRows: number | null;
  source?: ISpaceDataDbSharedTableCopyResult['source'];
  target: ISpaceDataDbSharedTableCopyResult['target'];
};

type ISharedTableCopyHeartbeat = {
  stage: 'copying_shared_rows';
  tableNames: string[];
  copiedTableCount: number;
  totalTables: number;
  totalCopiedRows: number | null;
  strategy: ISpaceDataDbSharedTableCopyStrategy;
  updatedAt: string;
};

type IBaseSchemaRelationCopySummary = {
  schemaName: string;
  relationName: string;
  relationKind: string;
  copiedRows: number;
  estimatedRows: number | null;
  totalBytes: number;
};

type IBaseSchemaCopyProgressPhase = 'dump' | 'restore';
type IBaseSchemaCopyHeartbeatStage = 'progress_poll' | 'post_copy_stats';
type IValidationHeartbeatStage = 'validating_copy';

type IBaseSchemaActiveCopyRelation = {
  schemaName: string;
  relationName: string;
  command: string | null;
  copyType: string | null;
  bytesProcessed: number | null;
  bytesTotal: number | null;
  tuplesProcessed: number | null;
  tuplesExcluded: number | null;
  estimatedRows: number | null;
  totalBytes: number | null;
};

type IBaseSchemaActiveCopyProgress = {
  phase: IBaseSchemaCopyProgressPhase;
  sampledAt: string;
  activeRelationCount: number;
  activeRelations: IBaseSchemaActiveCopyRelation[];
  error?: string;
};

type IBaseSchemaCopyHeartbeat = {
  stage: IBaseSchemaCopyHeartbeatStage;
  phase?: IBaseSchemaCopyProgressPhase;
  updatedAt: string;
};

type IValidationHeartbeat = {
  stage: IValidationHeartbeatStage;
  updatedAt: string;
};

type IBaseRelationColumnSignature = {
  ordinalPosition: number;
  columnName: string;
  formattedType: string;
  notNull: boolean;
  defaultExpression: string | null;
  identity: string;
  generated: string;
  collation: string | null;
};

type IBaseRelationIndexSignature = {
  indexName: string;
  isPrimary: boolean;
  isUnique: boolean;
  isValid: boolean;
  definition: string;
};

type IBaseRelationConstraintSignature = {
  constraintName: string;
  constraintType: string;
  definition: string;
};

type IBaseRelationTriggerSignature = {
  triggerName: string;
  enabled: string;
  definition: string;
};

type ITargetArtifactCleanupStats = {
  reason: string;
  baseSchemas: {
    schemaName: string;
    dropped: boolean;
  }[];
  sharedTables: {
    table: string;
    deletedRows: number | null;
    truncated?: boolean;
  }[];
  truncateSharedTables?: boolean;
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
};

type IPostSwitchWriteFinding = {
  object: string;
  reason: string;
  count?: number;
  expectedCount?: number;
  actualCount?: number;
  maxChangedAt?: string | null;
};

type IPostSwitchRollbackProof = {
  eligible: boolean;
  switchedAt: string;
  checkedAt: string;
  findings: IPostSwitchWriteFinding[];
};

type IMigrationProgressStats = {
  phase: string;
  totalSteps: number;
  completedSteps: number;
  percent: number;
  stage: ISpaceDataDbMigrationStageKey;
  stages: readonly ISpaceDataDbMigrationStage[];
  estimatedTotalBytes: number;
  completedEstimatedBytes: number;
  estimatedTotalRows: number;
  completedEstimatedRows: number;
  copiedBytes: number | null;
  bytesPerSecond: number | null;
  startedAt: string | null;
  updatedAt: string;
  etaMs: number | null;
};

type ISchemaOperationDrainSample = {
  id: string;
  status: string;
  phase: string;
  baseId: string | null;
  tableId: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  createdTime?: string | null;
  lastModifiedTime: string | null;
};

type ISchemaOperationDrainStats = {
  openCount: number;
  sample: ISchemaOperationDrainSample[];
  staleIgnoredCount?: number;
  staleIgnoredSample?: ISchemaOperationDrainSample[];
  staleBefore?: string;
  checkedAt: string;
};

type IBackgroundWriterDrainSample = {
  kind: 'provision_resource' | 'queue_job';
  resourceType?: 'base' | 'table' | 'field';
  queueName?: string;
  id: string;
  state: string;
  baseId: string | null;
  tableId: string | null;
  createdTime?: string | null;
  lastModifiedTime?: string | null;
  timestamp?: string | null;
};

type IBackgroundWriterDrainStats = {
  openCount: number;
  provisionResourceCount: number;
  queueJobCount: number;
  sample: IBackgroundWriterDrainSample[];
  staleIgnoredCount?: number;
  staleIgnoredSample?: IBackgroundWriterDrainSample[];
  staleBefore?: string;
  checkedAt: string;
};

type IMigrationJobRecord = {
  id: string;
  spaceId: string;
  state: string;
  sourceConnectionId: string | null;
  targetConnectionId: string | null;
  switchOnCompletion?: boolean | null;
  targetInternalSchema: string;
  createdBy: string;
  startedAt: Date | null;
  completedAt: Date | null;
  inventory: unknown;
  copyStats?: unknown;
  validationStats?: unknown;
  targetConnection: { encryptedUrl: string } | null;
};

type IRunMigrationJobOptions = {
  workDir?: string;
  jobs?: number;
  maxJobs?: number;
  baseSchemaCopyStrategy?: ISpaceDataDbBaseSchemaCopyStrategy;
  sharedTableCopyStrategy?: ISpaceDataDbSharedTableCopyStrategy;
  timeoutMs?: number;
  computedDrainTimeoutMs?: number;
  computedDrainPollMs?: number;
  computedProcessingLeaseMs?: number;
  schemaOperationDrainTimeoutMs?: number;
  schemaOperationDrainPollMs?: number;
  backgroundWriterDrainTimeoutMs?: number;
  backgroundWriterDrainPollMs?: number;
  backgroundWriterDrainProbeTimeoutMs?: number;
  backgroundWriterQueueScanBatchSize?: number;
  backgroundWriterQueueScanLimit?: number;
  tempDiskMultiplier?: number;
  tempDiskMinFreeBytes?: number;
};

type IResolvedRunMigrationJobOptions = Required<IRunMigrationJobOptions>;

type IMigrationJobStatusRecord = {
  id: string;
  spaceId: string;
  targetMode: string;
  switchOnCompletion?: boolean | null;
  state: string;
  targetInternalSchema: string;
  inventory: unknown;
  copyStats: unknown;
  validationStats: unknown;
  lastError: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdTime: Date;
  lastModifiedTime: Date | null;
  targetConnection: {
    provider: 'postgres';
    displayHost: string | null;
    displayDatabase: string | null;
    internalSchema: string;
    schemaVersion: string | null;
    lastValidatedAt: Date | null;
    lastError: string | null;
    capabilities: unknown;
  } | null;
};

type IRetryableMigrationJobRecord = {
  id: string;
  spaceId: string;
  state: string;
  switchOnCompletion?: boolean | null;
  targetConnectionId: string | null;
  inventory: unknown;
};

type IClaimableMigrationJobRecord = {
  id: string;
  state: string;
};

type IBaseSchemaCopyContext = {
  inventory: ISpaceDataDbInventory;
  schemaNames: string[];
  strategy: ISpaceDataDbBaseSchemaCopyStrategy;
  progressPollMs: number;
  startedAt: string;
};

type IBaseSchemaProgressClients = {
  dump: IDataDbPreflightClient;
  restore: IDataDbPreflightClient;
};

type ILegacyPublicAutoNumberSequence = {
  tableSchema: string;
  tableName: string;
  sequenceName: string;
};

type ISourceSnapshotHandle = {
  client: IDataDbPreflightClient;
  transaction: IDataDbPreflightTransaction;
  snapshotId: string;
  openedAt: string;
};

type ISourceDeltaRow = {
  seq: string | number | bigint;
  schemaName: string;
  tableName: string;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  pk: unknown;
  oldRow: unknown;
  newRow: unknown;
  capturedAt: string | Date;
};

type IDeltaReplayStats = {
  phase: string;
  lastCapturedSeq: number;
  lastReplayedSeq: number;
  lag: number;
  rowsApplied: number;
  startedAt: string;
  updatedAt?: string;
  completedAt?: string;
};

type IStaleMigrationJobRecord = IMigrationJobRecord & {
  lastModifiedTime: Date | null;
};

type IMigrationJobClient = {
  spaceDataDbMigrationJob: {
    findFirst(
      args: unknown
    ): Promise<({ id: string; state: string } | IMigrationJobStatusRecord) | null>;
    findMany(args: unknown): Promise<IMigrationJobStatusRecord[]>;
    findUnique(args: unknown): Promise<IMigrationJobRecord | null>;
    create(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

type IPrismaTransactionClient = {
  dataDbConnection: {
    upsert(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<unknown>;
  };
  spaceDataDbBinding: {
    upsert(args: unknown): Promise<unknown>;
  };
  spaceDataDbMigrationJob: {
    create(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<unknown>;
  };
};

type IDataPrismaIntrospectionClient = {
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
};

const dataDbUrlRequiredError = 'Data database URL is required';
const dataDbMigrationTable = '__teable_data_schema_migrations';
const deltaLogTable = '__teable_space_migration_delta_log';
const deltaCaptureFunction = '__teable_capture_space_migration_delta';
const deltaTriggerNamePrefix = '__teable_mig_delta_';
const sharedTables = {
  recordHistory: 'record_history',
  tableTrash: 'table_trash',
  recordTrash: 'record_trash',
  computedUpdateOutbox: 'computed_update_outbox',
  computedUpdateDeadLetter: 'computed_update_dead_letter',
  computedUpdateOutboxSeed: 'computed_update_outbox_seed',
  computedUpdatePauseScope: 'computed_update_pause_scope',
  undoLog: '__undo_log',
};
const relationKindsWithRows = new Set(['table', 'partitioned_table', 'foreign_table']);
const relationKindsWithColumns = new Set([
  'table',
  'partitioned_table',
  'foreign_table',
  'view',
  'materialized_view',
]);
const relationKindsWithIndexSignatures = new Set([
  'table',
  'partitioned_table',
  'foreign_table',
  'materialized_view',
]);
const relationKindsWithTableDependencySignatures = new Set([
  'table',
  'partitioned_table',
  'foreign_table',
]);
const validationFailedMessage = 'Space data database migration validation failed';
const metaFallbackDataDbCacheKey = 'meta-fallback';
const defaultMigrationCopyTimeoutMs = 24 * 60 * 60 * 1000;
const defaultMigrationCopyJobs = 1;
const defaultMigrationCopyMaxJobs = 4;
const defaultComputedDrainTimeoutMs = 10 * 60 * 1000;
const defaultComputedDrainPollMs = 5 * 1000;
const defaultComputedProcessingLeaseMs = 2 * 60 * 1000;
const defaultSchemaOperationDrainTimeoutMs = 10 * 60 * 1000;
const defaultSchemaOperationDrainPollMs = 5 * 1000;
const defaultBackgroundWriterDrainTimeoutMs = 10 * 60 * 1000;
const defaultBackgroundWriterDrainPollMs = 5 * 1000;
const defaultBackgroundWriterDrainProbeTimeoutMs = 30 * 1000;
const defaultBackgroundWriterQueueScanBatchSize = 100;
const defaultBackgroundWriterQueueScanLimit = 1000;
const defaultDrainStaleNonTerminalMs = 7 * 24 * 60 * 60 * 1000;
const defaultTempDiskMultiplier = 2;
const defaultTempDiskMinFreeBytes = 512 * 1024 * 1024;
const defaultTargetDiskMultiplier = 2;
const defaultTargetDiskMinFreeBytes = 1024 * 1024 * 1024;
const defaultLargeMigrationByteThreshold = 50 * 1024 * 1024 * 1024;
const defaultLargeMigrationRowThreshold = 10_000_000;
const defaultPostgresToolCheckTimeoutMs = 5_000;
const defaultCopyProgressPollMs = 5_000;
const defaultCopyProgressPollTimeoutMs = 30_000;
const defaultStaleActiveJobTimeoutMs = 5 * 60 * 1000;
const defaultDeltaReplayBatchSize = 500;
const defaultDeltaReplayLagThreshold = 0;
const defaultDeltaReplayCatchupTimeoutMs = 10 * 60 * 1000;
const defaultValidationConcurrency = 8;
const openSchemaOperationStatuses = ['pending', 'running', 'error'] as const;
const blockingProvisionStates = [ProvisionState.pending, ProvisionState.deleting] as const;
const openQueueJobStates = [
  'waiting',
  'active',
  'delayed',
  'prioritized',
  'waiting-children',
] as const;
const migrationProgressTotalSteps = 9;
const migrationProgressCompletedSteps: Record<string, number> = {
  postgres_tools_checking: 0,
  postgres_tools_checked: 0,
  postgres_tools_unavailable: 0,
  computed_paused: 1,
  computed_draining: 1,
  computed_drained: 2,
  computed_drain_timeout: 1,
  computed_drain_failed: 1,
  schema_operations_draining: 2,
  schema_operations_drained: 3,
  schema_operation_drain_timeout: 2,
  schema_operation_drain_failed: 2,
  background_writers_draining: 3,
  background_writers_drained: 4,
  background_writer_drain_timeout: 3,
  background_writer_drain_failed: 3,
  source_inventory_verified: 4,
  source_inventory_changed: 3,
  source_delta_capture_installed: 4,
  source_snapshot_exported: 4,
  temp_disk_checked: 5,
  temp_disk_insufficient: 4,
  copying_base_schemas: 5,
  base_schemas_completed: 6,
  base_schemas_failed: 5,
  copying_shared_rows: 6,
  shared_rows_completed: 7,
  shared_rows_failed: 6,
  delta_replaying: 7,
  delta_cutover_replaying: 8,
  delta_replayed: 8,
  final_writes_frozen: 8,
  validating_copy: 7,
  validation_completed: 8,
  validation_failed: 7,
  switching: 8,
  succeeded: 9,
  canceled_before_copy: 1,
};

const migrationPauseReason = (jobId: string) => `space-data-db-migration:${jobId}`;

const readPositiveIntEnv = (key: string, fallback: number) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

const readPositiveNumberEnv = (key: string, fallback: number) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const readNonNegativeIntEnv = (key: string, fallback: number) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
};

const readDisabledFlagEnv = (key: string) => {
  const value = process.env[key]?.trim().toLowerCase();
  return value === '0' || value === 'false' || value === 'off';
};

const readBaseSchemaCopyStrategyEnv = (
  key: string,
  fallback: ISpaceDataDbBaseSchemaCopyStrategy
): ISpaceDataDbBaseSchemaCopyStrategy => {
  const value = process.env[key];
  return value === 'pgcopydb' || value === 'pg_dump_restore' || value === 'pg_dump_stream_restore'
    ? value
    : fallback;
};

const readSharedTableCopyStrategyEnv = (
  key: string,
  fallback: ISpaceDataDbSharedTableCopyStrategy
): ISpaceDataDbSharedTableCopyStrategy => {
  const value = process.env[key];
  return value === 'postgres_fdw' || value === 'psql_copy' ? value : fallback;
};

const optionOrPositiveIntEnv = (optionValue: number | undefined, key: string, fallback: number) =>
  optionValue ?? readPositiveIntEnv(key, fallback);

const optionOrPositiveNumberEnv = (
  optionValue: number | undefined,
  key: string,
  fallback: number
) => optionValue ?? readPositiveNumberEnv(key, fallback);

const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(Math.floor(concurrency), items.length)) },
    async () => {
      for (let index = next++; index < items.length; index = next++) {
        results[index] = await fn(items[index], index);
      }
    }
  );
  await Promise.all(workers);
  return results;
};

const groupRelationSignatureRows = <T>(rows: IRelationScopedRow<T>[]): Map<string, T[]> => {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const { schemaName, relationName, ...signature } = row;
    const key = `${schemaName}.${relationName}`;
    const list = map.get(key);
    if (list) {
      list.push(signature as T);
    } else {
      map.set(key, [signature as T]);
    }
  }
  return map;
};

const normalizeRawRows = <T>(result: { rows?: T[] } | T[]): T[] => {
  if (Array.isArray(result)) {
    return result;
  }
  return result.rows ?? [];
};

const sortJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortJsonValue((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
};

const stableJsonStringify = (value: unknown): string => JSON.stringify(sortJsonValue(value));

const buildPostgresExtensionDependencyKey = (
  dependency: Pick<
    ISpaceDataDbPostgresExtensionDependency,
    'extensionName' | 'objectType' | 'schemaName' | 'objectName' | 'accessMethod'
  >
) =>
  [
    dependency.extensionName,
    dependency.objectType,
    dependency.schemaName,
    dependency.objectName,
    dependency.accessMethod,
  ].join(':');

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string) => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const quoteIdent = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

const qualify = (schema: string, table: string) => `${quoteIdent(schema)}.${quoteIdent(table)}`;

const sqlLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

const buildPreflightErrorMessage = (preflight: IDataDbPreflightVo) => {
  const errorCodes = preflight.errors.map((error) => error.code).join(', ');
  return errorCodes
    ? `Data database preflight failed: ${errorCodes}`
    : `Data database preflight failed: ${preflight.classification}`;
};

@Injectable()
export class SpaceDataDbMigrationService {
  private readonly clientFactory: IDataDbPreflightClientFactory;

  private readonly migrationProgressTracker = new SpaceDataDbMigrationProgressTracker();

  constructor(
    private readonly prismaService: PrismaService,
    private readonly preflightService: DataDbPreflightService,
    private readonly baselineService: DataDbBaselineService,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly copyService: SpaceDataDbCopyService,
    @Optional()
    @Inject(DATA_DB_PREFLIGHT_CLIENT_FACTORY)
    clientFactory?: IDataDbPreflightClientFactory,
    @Optional()
    @Inject(spaceDataDbStatfsToken)
    private readonly statfs: ISpaceDataDbStatfs = nodeStatfs,
    @Optional()
    @InjectQueue(BASE_IMPORT_CSV_QUEUE)
    private readonly baseImportCsvQueue?: Queue<unknown>,
    @Optional()
    @InjectQueue(BASE_IMPORT_JUNCTION_CSV_QUEUE)
    private readonly baseImportJunctionCsvQueue?: Queue<unknown>,
    @Optional()
    @InjectQueue(TABLE_IMPORT_CSV_CHUNK_QUEUE)
    private readonly tableImportCsvChunkQueue?: Queue<unknown>,
    @Optional()
    @InjectQueue(TABLE_IMPORT_CSV_QUEUE)
    private readonly tableImportCsvQueue?: Queue<unknown>
  ) {
    this.clientFactory = clientFactory ?? dataDbKnexClientFactory;
  }

  async startMigrationForSpace(spaceId: string, createdBy: string, dataDb: IDataDbPreflightRo) {
    if (dataDb.targetMode !== migrateSpaceTargetMode) {
      throw new CustomHttpException(
        'Only migrate-space BYODB target mode can start a space data DB migration',
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    if (!dataDb.url) {
      throw new CustomHttpException(dataDbUrlRequiredError, HttpErrorCode.VALIDATION_ERROR);
    }

    const relatedSpaces = await resolveSpaceDataDbRelatedSpaces(this.prismaService, spaceId);
    this.assertRelatedSpacesCanMigrateTogether(spaceId, relatedSpaces);
    const relatedSpaceIds = this.getRelatedSpaceIds(relatedSpaces);
    await this.assertNoActiveMigrationForSpaces(relatedSpaceIds, spaceId);

    const targetDatabaseFingerprint = fingerprintDatabaseUrl(dataDb.url);
    this.assertSpacesCanJoinTargetDataDb(relatedSpaces, targetDatabaseFingerprint, spaceId);
    const internalSchema = await this.resolveMigrationTargetInternalSchemaOrThrow(
      dataDb,
      relatedSpaces,
      targetDatabaseFingerprint,
      spaceId
    );
    const targetUrlFingerprint = fingerprintDataDbConnection(dataDb.url, internalSchema);
    this.assertRelatedSpacesShareSameTarget(relatedSpaces, targetUrlFingerprint, spaceId);
    const copySpaceIds = this.getRelatedSpaceIdsForCopy(relatedSpaces, targetUrlFingerprint);
    this.assertRequestedSpaceIsCopySource(spaceId, copySpaceIds);
    const inventory = await this.buildInventory(spaceId, internalSchema, relatedSpaces, {
      copySpaceIds,
    });
    this.assertLargeMigrationConfirmed(spaceId, inventory, dataDb.confirmLargeMigration === true);
    await this.runTargetPreflightOperation(
      dataDb,
      internalSchema,
      spaceId,
      'check_target_extension_dependencies',
      () => this.assertTargetSupportsSourceDependencies(dataDb.url, inventory, spaceId)
    );
    await this.assertTargetDiskCapacity(dataDb.url, inventory, spaceId);
    await this.cleanupRetryableTargetArtifacts({
      spaceId,
      targetUrlFingerprint,
      targetInternalSchema: internalSchema,
      inventory,
    });
    await this.runTargetPreflightOperation(
      dataDb,
      internalSchema,
      spaceId,
      'check_target_conflicts',
      () => this.assertTargetHasNoSpaceConflicts(dataDb.url, internalSchema, inventory, spaceId)
    );
    const prepared = await this.prepareMigrationTarget(dataDb.url, internalSchema);

    let connectionId: string | undefined;
    const runTransaction = this.prismaService.$tx.bind(this.prismaService) as unknown as <T>(
      fn: (prisma: IPrismaTransactionClient) => Promise<T>
    ) => Promise<T>;
    const job = await runTransaction(async (prisma) => {
      const connection = await prisma.dataDbConnection.upsert({
        where: { urlFingerprint: prepared.urlFingerprint },
        create: {
          provider: 'postgres',
          encryptedUrl: prepared.encryptedUrl,
          urlFingerprint: prepared.urlFingerprint,
          displayHost: prepared.displayHost,
          displayDatabase: prepared.displayDatabase,
          internalSchema: prepared.internalSchema,
          status: 'migrating',
          schemaVersion: prepared.schemaVersion,
          capabilities: prepared.capabilities,
          lastValidatedAt: new Date(),
          createdBy,
        },
        update: {
          encryptedUrl: prepared.encryptedUrl,
          displayHost: prepared.displayHost,
          displayDatabase: prepared.displayDatabase,
          internalSchema: prepared.internalSchema,
          status: 'migrating',
          schemaVersion: prepared.schemaVersion,
          capabilities: prepared.capabilities,
          lastValidatedAt: new Date(),
          lastError: null,
        },
        select: { id: true },
      });
      connectionId = connection.id;

      return await prisma.spaceDataDbMigrationJob.create({
        data: {
          spaceId,
          sourceConnectionId: null,
          targetConnectionId: connection.id,
          targetMode: migrateSpaceTargetMode,
          switchOnCompletion: dataDb.switchOnCompletion === true,
          state: 'waiting_worker',
          targetUrlFingerprint: prepared.urlFingerprint,
          targetInternalSchema: prepared.internalSchema,
          inventory,
          createdBy,
        },
        select: { id: true },
      });
    });

    if (connectionId) {
      await this.dataDbClientManager.invalidateConnection(connectionId);
    }

    return {
      jobId: job.id,
      connectionId,
    };
  }

  async preflightMigrationTargetForSpace(spaceId: string, dataDb: IDataDbPreflightRo) {
    if (!dataDb.url) {
      throw new CustomHttpException(dataDbUrlRequiredError, HttpErrorCode.VALIDATION_ERROR);
    }

    const relatedSpaces = await resolveSpaceDataDbRelatedSpaces(this.prismaService, spaceId);
    this.assertRelatedSpacesCanMigrateTogether(spaceId, relatedSpaces);
    const targetDatabaseFingerprint = fingerprintDatabaseUrl(dataDb.url);
    this.assertSpacesCanJoinTargetDataDb(relatedSpaces, targetDatabaseFingerprint, spaceId);
    const internalSchema = await this.resolveMigrationTargetInternalSchemaOrThrow(
      dataDb,
      relatedSpaces,
      targetDatabaseFingerprint,
      spaceId
    );
    const targetUrlFingerprint = fingerprintDataDbConnection(dataDb.url, internalSchema);
    this.assertRelatedSpacesShareSameTarget(relatedSpaces, targetUrlFingerprint, spaceId);
    const copySpaceIds = this.getRelatedSpaceIdsForCopy(relatedSpaces, targetUrlFingerprint);
    this.assertRequestedSpaceIsCopySource(spaceId, copySpaceIds);
    const inventory = await this.buildInventory(spaceId, internalSchema, relatedSpaces, {
      copySpaceIds,
    });

    const preflight = await this.preflightService.preflight({
      ...dataDb,
      targetMode: migrateSpaceTargetMode,
      internalSchema,
    });
    if (!preflight.ok) {
      return preflight;
    }

    await this.runTargetPreflightOperation(
      dataDb,
      internalSchema,
      spaceId,
      'check_target_extension_dependencies',
      () => this.assertTargetSupportsSourceDependencies(dataDb.url, inventory, spaceId)
    );
    await this.assertTargetDiskCapacity(dataDb.url, inventory, spaceId);
    const restartableTargetArtifactJob = await this.findRestartableTargetArtifactJob({
      spaceId,
      targetUrlFingerprint,
      targetInternalSchema: internalSchema,
    });
    if (
      !restartableTargetArtifactJob ||
      !this.isSuccessfulDryRunJob(restartableTargetArtifactJob)
    ) {
      await this.runTargetPreflightOperation(
        dataDb,
        internalSchema,
        spaceId,
        'check_target_conflicts',
        () => this.assertTargetHasNoSpaceConflicts(dataDb.url, internalSchema, inventory, spaceId)
      );
    }

    return {
      ...preflight,
      internalSchema,
    };
  }

  async claimNextPendingMigrationJob(workerId: string) {
    const claimableJob = (await this.migrationJobClient.spaceDataDbMigrationJob.findFirst({
      where: {
        targetMode: migrateSpaceTargetMode,
        state: { in: ['waiting_worker', 'pending'] },
      },
      orderBy: [{ createdTime: 'asc' }, { id: 'asc' }],
      select: { id: true, state: true },
    })) as unknown as IClaimableMigrationJobRecord | null;

    if (!claimableJob) {
      return null;
    }

    const claimedAt = new Date();
    const claimed = await this.migrationJobClient.spaceDataDbMigrationJob.updateMany({
      where: {
        id: claimableJob.id,
        state: claimableJob.state,
      },
      data: {
        state: 'preflight',
        startedAt: claimedAt,
        lastError: null,
        copyStats: {
          phase: 'worker_claimed',
          worker: {
            id: workerId,
            previousState: claimableJob.state,
            claimedAt: claimedAt.toISOString(),
          },
        },
      },
    });

    if (claimed.count !== 1) {
      return null;
    }

    return { jobId: claimableJob.id };
  }

  async recoverStaleActiveMigrationJobs(
    workerId: string,
    options: { staleAfterMs?: number; now?: Date } = {}
  ) {
    const staleAfterMs = Math.max(
      1,
      Math.floor(
        options.staleAfterMs ??
          readPositiveIntEnv(
            'BYODB_SPACE_DATA_DB_STALE_ACTIVE_JOB_TIMEOUT_MS',
            defaultStaleActiveJobTimeoutMs
          )
      )
    );
    const now = options.now ?? new Date();
    const staleBefore = new Date(now.getTime() - staleAfterMs);
    const states = activeSpaceDataDbMigrationStates.filter(
      (state) => state !== 'pending' && state !== 'waiting_worker'
    );
    const jobs = (await this.migrationJobClient.spaceDataDbMigrationJob.findMany({
      where: {
        targetMode: migrateSpaceTargetMode,
        state: { in: states },
        OR: [{ lastModifiedTime: null }, { lastModifiedTime: { lt: staleBefore } }],
      },
      include: { targetConnection: true },
      orderBy: [{ lastModifiedTime: 'asc' }, { createdTime: 'asc' }, { id: 'asc' }],
    })) as unknown as IStaleMigrationJobRecord[];

    const recovered: { jobId: string; state: string; lastError: string }[] = [];
    for (const job of jobs) {
      const lastProgressAt = job.lastModifiedTime?.toISOString() ?? 'never';
      const lastError = this.buildStaleMigrationJobLastError(job, lastProgressAt);
      const marked = await this.migrationJobClient.spaceDataDbMigrationJob.updateMany({
        where: {
          id: job.id,
          state: job.state,
          OR: [{ lastModifiedTime: null }, { lastModifiedTime: { lt: staleBefore } }],
        },
        data: {
          state: 'failed',
          completedAt: now,
          lastError,
          copyStats: {
            ...(this.asRecord(job.copyStats) ?? {}),
            staleRecovery: {
              errorCode: spaceDataDbStaleActiveJobErrorCode,
              workerId,
              previousState: job.state,
              staleAfterMs,
              staleBefore: staleBefore.toISOString(),
              recoveredAt: now.toISOString(),
            },
          },
        },
      });
      if (marked.count !== 1) {
        continue;
      }

      await this.resumeSourceComputedForJob(job.id).catch(() => undefined);
      if (['copying', 'validating'].includes(job.state)) {
        await this.cleanupTargetArtifactsForJob(job.id, 'stale_active_job', {
          truncateSharedTables: await this.canTruncateTargetSharedTables(job.targetConnectionId),
        }).catch(() => undefined);
      }

      recovered.push({ jobId: job.id, state: job.state, lastError });
    }

    return recovered;
  }

  private buildStaleMigrationJobLastError(job: IStaleMigrationJobRecord, lastProgressAt: string) {
    const copyFailure = this.getStaleBaseSchemaCopyFailure(job.copyStats);
    if (!copyFailure) {
      return `Space data database migration job ${job.id} is stale; no worker progress since ${lastProgressAt}`;
    }

    return [
      copyFailure,
      `The migration worker was recovered as stale after no progress since ${lastProgressAt}.`,
    ].join(' ');
  }

  private getStaleBaseSchemaCopyFailure(copyStats: unknown) {
    const stats = this.asRecord(copyStats);
    if (stats?.phase !== 'copying_base_schemas') {
      return null;
    }

    const baseSchemas = this.asRecord(stats.baseSchemas);
    const activeCopy = this.asRecord(baseSchemas?.activeCopy);
    const activeCopyError =
      typeof activeCopy?.error === 'string' && activeCopy.error.trim()
        ? activeCopy.error.trim()
        : null;
    if (activeCopyError) {
      const phase =
        activeCopy?.phase === 'restore' ? 'target PostgreSQL restore' : 'source PostgreSQL dump';
      return `Base schema copy stopped during ${phase} progress polling: ${this.sanitizeTargetDiskError(
        activeCopyError
      )}.`;
    }

    const baseSchemaError =
      typeof baseSchemas?.error === 'string' && baseSchemas.error.trim()
        ? baseSchemas.error.trim()
        : null;
    if (baseSchemaError) {
      return `Base schema copy stopped: ${this.sanitizeTargetDiskError(baseSchemaError)}.`;
    }

    const heartbeat = this.asRecord(baseSchemas?.heartbeat);
    if (heartbeat?.stage === 'progress_poll') {
      const phase =
        heartbeat.phase === 'restore' ? 'target PostgreSQL restore' : 'source PostgreSQL dump';
      return `Base schema copy stopped while waiting for ${phase} progress polling to complete.`;
    }

    return null;
  }

  private async cleanupRetryableTargetArtifacts(input: {
    spaceId: string;
    targetUrlFingerprint: string;
    targetInternalSchema: string;
    inventory: ISpaceDataDbInventory;
  }) {
    const retryableJob = await this.findRestartableTargetArtifactJob(input);

    if (!retryableJob) {
      return;
    }

    if (!this.isSuccessfulDryRunJob(retryableJob)) {
      const previousInventory = this.normalizeInventory(
        retryableJob.inventory,
        retryableJob.spaceId ?? input.spaceId
      );
      const mismatches = this.compareInventoryForCopy(previousInventory, input.inventory, {
        compareSharedScope: false,
      });
      if (mismatches.length) {
        return;
      }
    }

    await this.cleanupTargetArtifactsForJob(retryableJob.id, 'retry_before_start', {
      truncateSharedTables: await this.canTruncateTargetSharedTables(
        retryableJob.targetConnectionId
      ),
    });
  }

  private async findRestartableTargetArtifactJob(input: {
    spaceId: string;
    targetUrlFingerprint: string;
    targetInternalSchema: string;
  }): Promise<IRetryableMigrationJobRecord | null> {
    return (await this.migrationJobClient.spaceDataDbMigrationJob.findFirst({
      where: {
        spaceId: input.spaceId,
        targetMode: migrateSpaceTargetMode,
        targetUrlFingerprint: input.targetUrlFingerprint,
        targetInternalSchema: input.targetInternalSchema,
        OR: [
          { state: { in: ['failed', 'canceled'] } },
          { state: 'succeeded', switchOnCompletion: false },
        ],
      },
      orderBy: { createdTime: 'desc' },
      select: {
        id: true,
        spaceId: true,
        state: true,
        switchOnCompletion: true,
        targetConnectionId: true,
        inventory: true,
      },
    })) as IRetryableMigrationJobRecord | null;
  }

  private isSuccessfulDryRunJob(
    job: Pick<IRetryableMigrationJobRecord, 'state' | 'switchOnCompletion'>
  ) {
    return job.state === 'succeeded' && job.switchOnCompletion !== true;
  }

  private async canTruncateTargetSharedTables(targetConnectionId: string | null) {
    if (!targetConnectionId) {
      return false;
    }
    const bindings = await this.prismaService.spaceDataDbBinding.findMany({
      where: { dataDbConnectionId: targetConnectionId },
      select: { spaceId: true },
      take: 1,
    });
    return bindings.length === 0;
  }

  private assertLargeMigrationConfirmed(
    spaceId: string,
    inventory: ISpaceDataDbInventory,
    confirmed: boolean
  ) {
    const byteThreshold = readNonNegativeIntEnv(
      'BYODB_SPACE_DATA_DB_LARGE_MIGRATION_BYTES',
      defaultLargeMigrationByteThreshold
    );
    const rowThreshold = readNonNegativeIntEnv(
      'BYODB_SPACE_DATA_DB_LARGE_MIGRATION_ROWS',
      defaultLargeMigrationRowThreshold
    );
    const reasons = [
      byteThreshold > 0 && inventory.estimatedTotalBytes > byteThreshold
        ? {
            metric: 'estimatedTotalBytes',
            estimated: inventory.estimatedTotalBytes,
            threshold: byteThreshold,
          }
        : null,
      rowThreshold > 0 && inventory.estimatedTotalRows > rowThreshold
        ? {
            metric: 'estimatedTotalRows',
            estimated: inventory.estimatedTotalRows,
            threshold: rowThreshold,
          }
        : null,
    ].filter(Boolean);

    if (!reasons.length || confirmed) {
      return;
    }

    throw new CustomHttpException(
      'Space data database migration is above the large-space confirmation threshold',
      HttpErrorCode.CONFLICT,
      {
        errorCode: spaceDataDbLargeMigrationConfirmationRequiredErrorCode,
        confirmationField: 'confirmLargeMigration',
        spaceId,
        estimatedTotalBytes: inventory.estimatedTotalBytes,
        estimatedTotalRows: inventory.estimatedTotalRows,
        baseCount: inventory.baseIds.length,
        tableCount: inventory.tableIds.length,
        physicalSchemaCount: inventory.physicalSchemas.length,
        thresholds: {
          bytes: byteThreshold,
          rows: rowThreshold,
        },
        reasons,
      }
    );
  }

  async assertTargetDiskCapacity(
    targetUrl: string,
    inventory: ISpaceDataDbInventory,
    spaceId: string
  ) {
    const multiplier = readPositiveNumberEnv(
      'BYODB_SPACE_DATA_DB_TARGET_DISK_MULTIPLIER',
      defaultTargetDiskMultiplier
    );
    const minFreeBytes = readNonNegativeIntEnv(
      'BYODB_SPACE_DATA_DB_TARGET_DISK_MIN_FREE_BYTES',
      defaultTargetDiskMinFreeBytes
    );
    const requiredBytes = Math.max(
      Math.ceil(inventory.estimatedTotalBytes * multiplier),
      minFreeBytes
    );
    const capacity = await this.inspectTargetDiskCapacity(targetUrl);

    if (
      !capacity.checked ||
      capacity.availableBytes == null ||
      capacity.availableBytes >= requiredBytes
    ) {
      return;
    }

    throw new CustomHttpException(
      'Target data database does not have enough disk space for migration',
      HttpErrorCode.CONFLICT,
      {
        errorCode: spaceDataDbTargetDiskInsufficientErrorCode,
        spaceId,
        estimatedTotalBytes: inventory.estimatedTotalBytes,
        estimatedTotalRows: inventory.estimatedTotalRows,
        requiredBytes,
        availableBytes: capacity.availableBytes,
        multiplier,
        minFreeBytes,
        targetDisk: capacity,
      }
    );
  }

  private async inspectTargetDiskCapacity(targetUrl: string): Promise<ITargetDiskCapacity> {
    const checkedAt = new Date().toISOString();
    const client = this.clientFactory(targetUrl);
    try {
      const dataDirectoryRows = normalizeRawRows<{ setting: string }>(
        await client.raw(`SELECT current_setting('data_directory') AS setting`)
      );
      const dataDirectory = dataDirectoryRows[0]?.setting;
      if (!dataDirectory) {
        return { checked: false, reason: 'data_directory_unavailable', checkedAt };
      }

      const command = [
        'bash',
        '-lc',
        [
          'set -euo pipefail',
          `target=${shellQuote(dataDirectory)}`,
          'mount=$(df -P "$target" | awk \'NR==2 {print $6}\')',
          'df -B1 -P "$mount" | awk -v mount="$mount" \'NR==2 {print mount "|" $2 "|" $3 "|" $4}\'',
        ].join('; '),
      ]
        .map(shellQuote)
        .join(' ');
      await client.raw(`CREATE TEMP TABLE IF NOT EXISTS __teable_target_disk_capacity(line text)`);
      await client.raw(`TRUNCATE __teable_target_disk_capacity`);
      await client.raw(
        `COPY __teable_target_disk_capacity FROM PROGRAM '${command.replace(/'/g, "''")}'`
      );
      const rows = normalizeRawRows<{ line: string }>(
        await client.raw(`SELECT line FROM __teable_target_disk_capacity LIMIT 1`)
      );
      const [mountPath, totalBytes, usedBytes, availableBytes] = String(rows[0]?.line ?? '').split(
        '|'
      );
      const available = Number(availableBytes);
      const total = Number(totalBytes);
      const used = Number(usedBytes);
      if (!mountPath || !Number.isFinite(available)) {
        return { checked: false, reason: 'df_output_unavailable', dataDirectory, checkedAt };
      }
      return {
        checked: true,
        dataDirectory,
        mountPath,
        availableBytes: available,
        totalBytes: Number.isFinite(total) ? total : undefined,
        usedBytes: Number.isFinite(used) ? used : undefined,
        checkedAt,
      };
    } catch (error) {
      return {
        checked: false,
        reason:
          error instanceof Error ? this.sanitizeTargetDiskError(error.message) : String(error),
        checkedAt,
      };
    } finally {
      await client.destroy().catch(() => undefined);
    }
  }

  private sanitizeTargetDiskError(message: string) {
    return message.replace(/postgresql:\/\/[^@\s]+@/g, 'postgresql://***@').slice(0, 500);
  }

  async copyBaseSchemasForJob(
    jobId: string,
    options: {
      workDir: string;
      jobs?: number;
      timeoutMs?: number;
      strategy?: ISpaceDataDbBaseSchemaCopyStrategy;
      progressPollMs?: number;
      snapshotId?: string;
    }
  ) {
    const job = await this.migrationJobClient.spaceDataDbMigrationJob.findUnique({
      where: { id: jobId },
      include: { targetConnection: true },
    });
    if (!job) {
      throw new CustomHttpException(`Migration job ${jobId} not found`, HttpErrorCode.NOT_FOUND);
    }
    if (!job.targetConnection?.encryptedUrl) {
      throw new CustomHttpException(
        `Migration job ${jobId} has no target connection`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }

    const context = this.buildBaseSchemaCopyContext(job, options);
    const { inventory, schemaNames, strategy, progressPollMs, startedAt } = context;
    const sourceDataDb = await this.getSourceDataDbForJob(job);
    const targetUrl = decryptDataDbUrl(job.targetConnection.encryptedUrl);

    await this.migrationJobClient.spaceDataDbMigrationJob.update({
      where: { id: jobId },
      data: {
        state: 'copying',
        copyStats: {
          phase: 'copying_base_schemas',
          progress: this.buildMigrationProgress(job, inventory, 'copying_base_schemas'),
          baseSchemas: {
            schemaNames,
            strategy,
            progressPollMs,
            excludedForeignKeys: inventory.outOfScopeForeignKeys,
            startedAt,
          },
        },
        lastError: null,
      },
    });

    let progressClients: IBaseSchemaProgressClients | null = null;
    try {
      await this.installTargetPublicUndoCaptureCompatibility(targetUrl);
      const legacyPublicAutoNumberSequences =
        await this.prepareTargetLegacyPublicAutoNumberSequences(
          sourceDataDb.url,
          targetUrl,
          schemaNames
        );
      progressClients = this.createBaseSchemaProgressClients(strategy, sourceDataDb.url, targetUrl);
      const result = await this.copyService.copyBaseSchemas({
        sourceUrl: sourceDataDb.url,
        targetUrl,
        schemaNames,
        workDir: options.workDir,
        jobs: options.jobs,
        strategy,
        snapshotId: options.snapshotId,
        excludedForeignKeys: inventory.outOfScopeForeignKeys,
        processOptions: this.buildCancelableProcessOptions(
          jobId,
          options.timeoutMs,
          progressPollMs
        ),
        hooks: progressClients
          ? this.buildBaseSchemaCopyHooks(job, context, progressClients)
          : undefined,
      });
      await this.syncTargetLegacyPublicAutoNumberSequences(
        sourceDataDb.url,
        targetUrl,
        legacyPublicAutoNumberSequences
      );
      const copiedRelations = await this.withMigrationHeartbeat(
        () =>
          this.updateBaseSchemaCopyHeartbeat(job, context, {
            stage: 'post_copy_stats',
            updatedAt: new Date().toISOString(),
          }),
        () => this.inspectBaseSchemaCopyRows(targetUrl, inventory),
        progressPollMs
      );
      const copyStats = this.buildBaseSchemaCompletedStats(job, context, result, copiedRelations);
      await this.migrationJobClient.spaceDataDbMigrationJob.update({
        where: { id: jobId },
        data: {
          state: 'copying',
          copyStats,
          lastError: null,
        },
      });
      return copyStats;
    } catch (error) {
      if (await this.isProcessCancelErrorForJob(error, jobId)) {
        throw error;
      }
      const lastError = this.buildProcessFailureMessage(error);
      await this.migrationJobClient.spaceDataDbMigrationJob.update({
        where: { id: jobId },
        data: {
          state: 'failed',
          lastError,
          copyStats: {
            phase: 'base_schemas_failed',
            progress: this.buildMigrationProgress(job, inventory, 'base_schemas_failed'),
            baseSchemas: {
              schemaNames,
              progressPollMs,
              excludedForeignKeys: inventory.outOfScopeForeignKeys,
              failedAt: new Date().toISOString(),
              error: lastError,
              failure: this.buildProcessFailureStats(error),
            },
          },
        },
      });
      throw error;
    } finally {
      await progressClients?.dump.destroy().catch(() => undefined);
      await progressClients?.restore.destroy().catch(() => undefined);
    }
  }

  private async prepareTargetLegacyPublicAutoNumberSequences(
    sourceUrl: string,
    targetUrl: string,
    schemaNames: string[]
  ) {
    const sourceClient = this.clientFactory(sourceUrl);
    const targetClient = this.clientFactory(targetUrl);
    try {
      const sequences = await this.listLegacyPublicAutoNumberSequences(sourceClient, schemaNames);
      for (const sequence of sequences) {
        await targetClient.raw(
          `CREATE SEQUENCE IF NOT EXISTS ${qualify('public', sequence.sequenceName)}`
        );
      }
      return sequences;
    } finally {
      await sourceClient.destroy().catch(() => undefined);
      await targetClient.destroy().catch(() => undefined);
    }
  }

  private async syncTargetLegacyPublicAutoNumberSequences(
    sourceUrl: string,
    targetUrl: string,
    sequences: ILegacyPublicAutoNumberSequence[]
  ) {
    if (!sequences.length) {
      return;
    }

    const sourceClient = this.clientFactory(sourceUrl);
    const targetClient = this.clientFactory(targetUrl);
    try {
      for (const sequence of sequences) {
        const qualifiedSequence = qualify('public', sequence.sequenceName);
        const rows = normalizeRawRows<{ lastValue: string | number | bigint; isCalled: boolean }>(
          await sourceClient.raw(
            `SELECT last_value AS "lastValue", is_called AS "isCalled" FROM ${qualifiedSequence}`
          )
        );
        const state = rows[0];
        if (!state) {
          continue;
        }
        await targetClient.raw(`SELECT setval(?::regclass, ?::bigint, ?::boolean)`, [
          `public.${quoteIdent(sequence.sequenceName)}`,
          String(state.lastValue),
          state.isCalled,
        ]);
      }
    } finally {
      await sourceClient.destroy().catch(() => undefined);
      await targetClient.destroy().catch(() => undefined);
    }
  }

  private async listLegacyPublicAutoNumberSequences(
    sourceClient: IDataDbPreflightClient,
    schemaNames: string[]
  ): Promise<ILegacyPublicAutoNumberSequence[]> {
    if (!schemaNames.length) {
      return [];
    }

    const rows = normalizeRawRows<{
      tableSchema: string;
      tableName: string;
      sequenceSchema: string;
      sequenceName: string;
    }>(
      await sourceClient.raw(
        `
          SELECT table_ns.nspname AS "tableSchema",
                 table_class.relname AS "tableName",
                 sequence_ns.nspname AS "sequenceSchema",
                 sequence_class.relname AS "sequenceName"
          FROM pg_attrdef AS attr_def
          INNER JOIN pg_attribute AS attr
            ON attr.attrelid = attr_def.adrelid
           AND attr.attnum = attr_def.adnum
           AND NOT attr.attisdropped
          INNER JOIN pg_class AS table_class
            ON table_class.oid = attr_def.adrelid
          INNER JOIN pg_namespace AS table_ns
            ON table_ns.oid = table_class.relnamespace
          INNER JOIN pg_depend AS dependency
            ON dependency.classid = 'pg_attrdef'::regclass
           AND dependency.objid = attr_def.oid
           AND dependency.refclassid = 'pg_class'::regclass
          INNER JOIN pg_class AS sequence_class
            ON sequence_class.oid = dependency.refobjid
           AND sequence_class.relkind = 'S'
          INNER JOIN pg_namespace AS sequence_ns
            ON sequence_ns.oid = sequence_class.relnamespace
          WHERE table_ns.nspname = ANY(?::text[])
            AND attr.attname = '__auto_number'
            AND sequence_ns.nspname = 'public'
        `,
        [schemaNames]
      )
    );

    const seen = new Set<string>();
    const sequences: ILegacyPublicAutoNumberSequence[] = [];
    for (const row of rows) {
      const sequenceKey = `${row.sequenceSchema}.${row.sequenceName}`;
      if (seen.has(sequenceKey)) {
        continue;
      }
      seen.add(sequenceKey);
      sequences.push({
        tableSchema: row.tableSchema,
        tableName: row.tableName,
        sequenceName: row.sequenceName,
      });
    }
    return sequences;
  }

  private buildBaseSchemaCopyContext(
    job: IMigrationJobRecord,
    options: { strategy?: ISpaceDataDbBaseSchemaCopyStrategy; progressPollMs?: number }
  ): IBaseSchemaCopyContext {
    const inventory = this.normalizeInventory(job.inventory, job.spaceId);
    const requestedStrategy = options.strategy ?? 'pg_dump_stream_restore';
    return {
      inventory,
      schemaNames: inventory.physicalSchemas.length
        ? inventory.physicalSchemas.map((schema) => schema.schemaName)
        : inventory.baseIds,
      strategy:
        requestedStrategy === 'pg_dump_stream_restore' && inventory.outOfScopeForeignKeys.length
          ? 'pg_dump_restore'
          : requestedStrategy,
      progressPollMs: Math.max(
        1,
        Math.floor(
          options.progressPollMs ??
            readPositiveIntEnv(
              'BYODB_SPACE_DATA_DB_COPY_PROGRESS_POLL_MS',
              defaultCopyProgressPollMs
            )
        )
      ),
      startedAt: new Date().toISOString(),
    };
  }

  private createBaseSchemaProgressClients(
    strategy: ISpaceDataDbBaseSchemaCopyStrategy,
    sourceUrl: string,
    targetUrl: string
  ): IBaseSchemaProgressClients | null {
    return strategy === 'pg_dump_restore' || strategy === 'pg_dump_stream_restore'
      ? {
          dump: this.clientFactory(sourceUrl),
          restore: this.clientFactory(targetUrl),
        }
      : null;
  }

  private buildBaseSchemaCopyHooks(
    job: IMigrationJobRecord,
    context: IBaseSchemaCopyContext,
    clients: IBaseSchemaProgressClients
  ) {
    return {
      onDumpProgressPoll: () =>
        this.updateBaseSchemaCopyProgress({
          job,
          ...context,
          phase: 'dump',
          client: clients.dump,
        }),
      onRestoreProgressPoll: () =>
        this.updateBaseSchemaCopyProgress({
          job,
          ...context,
          phase: 'restore',
          client: clients.restore,
        }),
    };
  }

  private async updateBaseSchemaCopyHeartbeat(
    job: IMigrationJobRecord,
    context: IBaseSchemaCopyContext,
    heartbeat: IBaseSchemaCopyHeartbeat
  ) {
    await this.migrationJobClient.spaceDataDbMigrationJob
      .update({
        where: { id: job.id },
        data: {
          state: 'copying',
          copyStats: {
            phase: 'copying_base_schemas',
            progress: this.buildMigrationProgress(job, context.inventory, 'copying_base_schemas'),
            baseSchemas: {
              schemaNames: context.schemaNames,
              strategy: context.strategy,
              progressPollMs: context.progressPollMs,
              excludedForeignKeys: context.inventory.outOfScopeForeignKeys,
              startedAt: context.startedAt,
              heartbeat,
            },
          },
          lastError: null,
        },
      })
      .catch(() => undefined);
  }

  private buildBaseSchemaProcessStats(result: ISpaceDataDbBaseSchemaCopyResult) {
    if (result.strategy === 'pgcopydb') {
      return {
        strategy: result.strategy,
        pgcopydb: result.pgcopydb,
      };
    }
    if (result.strategy === 'pg_dump_stream_restore') {
      return {
        strategy: result.strategy,
        stream: result.stream,
      };
    }
    return {
      strategy: result.strategy,
      dump: result.dump,
      ...(result.restoreList ? { restoreList: result.restoreList } : {}),
      ...(result.filteredRestoreList ? { filteredRestoreList: result.filteredRestoreList } : {}),
      restore: result.restore,
    };
  }

  private buildBaseSchemaCompletedStats(
    job: IMigrationJobRecord,
    context: IBaseSchemaCopyContext,
    result: ISpaceDataDbBaseSchemaCopyResult,
    copiedRelations: IBaseSchemaRelationCopySummary[]
  ) {
    return {
      phase: 'base_schemas_completed',
      progress: this.buildMigrationProgress(job, context.inventory, 'base_schemas_completed'),
      baseSchemas: {
        schemaNames: context.schemaNames,
        progressPollMs: context.progressPollMs,
        excludedForeignKeys: context.inventory.outOfScopeForeignKeys,
        copiedRelationCount: copiedRelations.length,
        totalCopiedRows: copiedRelations.reduce((sum, relation) => sum + relation.copiedRows, 0),
        copiedRelations,
        ...this.buildBaseSchemaProcessStats(result),
        completedAt: new Date().toISOString(),
      },
    };
  }

  async runMigrationJob(jobId: string, options: IRunMigrationJobOptions = {}) {
    const {
      workDir,
      jobs,
      baseSchemaCopyStrategy,
      sharedTableCopyStrategy,
      timeoutMs,
      computedDrainTimeoutMs,
      computedDrainPollMs,
      computedProcessingLeaseMs,
      schemaOperationDrainTimeoutMs,
      schemaOperationDrainPollMs,
      backgroundWriterDrainTimeoutMs,
      backgroundWriterDrainPollMs,
      backgroundWriterDrainProbeTimeoutMs,
      backgroundWriterQueueScanBatchSize,
      backgroundWriterQueueScanLimit,
      tempDiskMultiplier,
      tempDiskMinFreeBytes,
    } = this.resolveRunMigrationJobOptions(jobId, options);

    await mkdir(workDir, { recursive: true });
    await this.assertMigrationNotCanceled(jobId);
    const freezeSourceWrites = await this.shouldFreezeSourceWritesForJob(jobId);
    let pause: { created: boolean } = { created: false };
    let targetArtifactsMayExist = false;
    let sourceSnapshot: ISourceSnapshotHandle | null = null;
    try {
      await this.assertPostgresCopyToolsAvailableForJob(jobId, {
        timeoutMs,
        baseSchemaCopyStrategy,
      });
      const job = await this.getMigrationJob(jobId);
      const sourceDataDb = await this.getSourceDataDbForJob(job);
      await this.waitForSchemaOperationsForJob(jobId, {
        timeoutMs: schemaOperationDrainTimeoutMs,
        pollMs: schemaOperationDrainPollMs,
      });
      await this.assertSourceInventoryUnchangedForJob(jobId);
      await this.migrationJobClient.spaceDataDbMigrationJob.update({
        where: { id: jobId },
        data: {
          state: 'freezing_writes',
          copyStats: {
            ...(this.asRecord(job.copyStats) ?? {}),
            phase: 'source_snapshot_exported',
            progress: this.buildMigrationProgress(
              job,
              this.normalizeInventory(job.inventory, job.spaceId),
              'source_snapshot_exported'
            ),
            initialGate: {
              startedAt: new Date().toISOString(),
            },
          },
          lastError: null,
        },
      });
      await delay(readNonNegativeIntEnv('BYODB_SPACE_DATA_DB_INITIAL_WRITE_DRAIN_MS', 2_000));
      sourceSnapshot = await this.openSourceSnapshot(sourceDataDb.url);
      await this.installSourceDeltaCaptureForJob(job, sourceDataDb);
      const jobAfterDeltaInstall = await this.getMigrationJob(jobId);
      await this.migrationJobClient.spaceDataDbMigrationJob.update({
        where: { id: jobId },
        data: {
          state: 'copying',
          copyStats: {
            ...(this.asRecord(jobAfterDeltaInstall.copyStats) ?? {}),
            phase: 'source_delta_capture_installed',
            progress: this.buildMigrationProgress(
              job,
              this.normalizeInventory(job.inventory, job.spaceId),
              'source_delta_capture_installed'
            ),
            initialGate: {
              releasedAt: new Date().toISOString(),
              snapshotId: sourceSnapshot.snapshotId,
            },
          },
          lastError: null,
        },
      });
      await this.assertTempWorkDirCapacityForJob(jobId, workDir, {
        multiplier: tempDiskMultiplier,
        minFreeBytes: tempDiskMinFreeBytes,
        baseSchemaCopyStrategy,
      });
      await this.assertMigrationNotCanceled(jobId);
      targetArtifactsMayExist = true;
      await this.copyBaseSchemasForJob(jobId, {
        workDir,
        jobs,
        timeoutMs,
        strategy: baseSchemaCopyStrategy,
        snapshotId: sourceSnapshot.snapshotId,
      });
      await this.copySharedRowsForJob(jobId, {
        timeoutMs,
        strategy: sharedTableCopyStrategy,
        snapshotId: sourceSnapshot.snapshotId,
      });
      await this.closeSourceSnapshot(sourceSnapshot);
      sourceSnapshot = null;
      await this.replayDeltaForJob(jobId, { phase: 'delta_replaying' });
      if (freezeSourceWrites) {
        const jobBeforeFinalGate = await this.getMigrationJob(jobId);
        await this.migrationJobClient.spaceDataDbMigrationJob.update({
          where: { id: jobId },
          data: {
            state: 'freezing_writes',
            copyStats: {
              ...(this.asRecord(jobBeforeFinalGate.copyStats) ?? {}),
              phase: 'final_writes_frozen',
              progress: this.buildMigrationProgress(
                job,
                this.normalizeInventory(job.inventory, job.spaceId),
                'final_writes_frozen'
              ),
              finalGate: {
                startedAt: new Date().toISOString(),
              },
            },
            lastError: null,
          },
        });
        pause = await this.pauseSourceComputedForJob(jobId);
        await this.waitForSourceComputedDrainForJob(jobId, {
          timeoutMs: computedDrainTimeoutMs,
          pollMs: computedDrainPollMs,
          processingLeaseMs: computedProcessingLeaseMs,
        });
        await this.waitForSchemaOperationsForJob(jobId, {
          timeoutMs: schemaOperationDrainTimeoutMs,
          pollMs: schemaOperationDrainPollMs,
        });
        await this.waitForBackgroundWritersForJob(jobId, {
          timeoutMs: backgroundWriterDrainTimeoutMs,
          pollMs: backgroundWriterDrainPollMs,
          probeTimeoutMs: backgroundWriterDrainProbeTimeoutMs,
          queueScanBatchSize: backgroundWriterQueueScanBatchSize,
          queueScanLimit: backgroundWriterQueueScanLimit,
        });
        await this.assertSourceInventoryUnchangedForJob(jobId);
        await this.replayDeltaForJob(jobId, {
          phase: 'delta_cutover_replaying',
          lagThreshold: 0,
        });
      }
      await this.syncTargetLegacyPublicAutoNumberSequencesForJob(jobId);
      return await this.validateAndSwitchJob(jobId);
    } catch (error) {
      await this.closeSourceSnapshot(sourceSnapshot).catch(() => undefined);
      if (pause.created) {
        await this.resumeSourceComputedForJob(jobId).catch(() => undefined);
      }
      const job = await this.getMigrationJob(jobId).catch(() => null);
      if (job) {
        await this.cleanupSourceDeltaCaptureForJob(job).catch(() => undefined);
      }
      if (targetArtifactsMayExist) {
        await this.cleanupTargetArtifactsForJob(jobId, 'pre_switch_failure').catch(() => undefined);
      }
      await this.completeFailedMigrationJob(jobId, error).catch(() => undefined);
      throw error;
    }
  }

  private async shouldFreezeSourceWritesForJob(jobId: string) {
    const job = await this.getMigrationJob(jobId);
    return job.switchOnCompletion === true;
  }

  private async syncTargetLegacyPublicAutoNumberSequencesForJob(jobId: string) {
    const job = await this.getMigrationJob(jobId);
    if (!job.targetConnection?.encryptedUrl) {
      return;
    }

    const inventory = this.normalizeInventory(job.inventory, job.spaceId);
    const schemaNames = inventory.physicalSchemas.map((schema) => schema.schemaName);
    if (!schemaNames.length) {
      return;
    }

    const sourceDataDb = await this.getSourceDataDbForJob(job);
    const targetUrl = decryptDataDbUrl(job.targetConnection.encryptedUrl);
    const sequences = await this.prepareTargetLegacyPublicAutoNumberSequences(
      sourceDataDb.url,
      targetUrl,
      schemaNames
    );
    await this.syncTargetLegacyPublicAutoNumberSequences(sourceDataDb.url, targetUrl, sequences);
  }

  private deltaTriggerName(jobId: string) {
    return `${deltaTriggerNamePrefix}${jobId.replace(/\W/g, '_').slice(-32)}`;
  }

  private isMigrationDeltaTrigger(trigger: IBaseRelationTriggerSignature) {
    return trigger.triggerName.startsWith(deltaTriggerNamePrefix);
  }

  private getSourceSchema(sourceDataDb: IResolvedDataDatabase) {
    return sourceDataDb.internalSchema ?? 'public';
  }

  private getDeltaCaptureRelations(inventory: ISpaceDataDbInventory, sourceSchema: string) {
    const baseRelations = inventory.physicalSchemas.flatMap((schema) =>
      schema.relations
        .filter((relation) => relationKindsWithRows.has(relation.relationKind))
        .map((relation) => ({
          schemaName: relation.schemaName,
          tableName: relation.relationName,
        }))
    );
    const sharedRelations = Object.values(sharedTables).map((tableName) => ({
      schemaName: sourceSchema,
      tableName,
    }));
    const seen = new Set<string>();
    return [...baseRelations, ...sharedRelations].filter((relation) => {
      const key = `${relation.schemaName}.${relation.tableName}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private async openSourceSnapshot(sourceUrl: string): Promise<ISourceSnapshotHandle> {
    const client = this.clientFactory(sourceUrl);
    let transaction: IDataDbPreflightTransaction | null = null;
    try {
      if (!client.beginTransaction) {
        throw new Error('PostgreSQL client does not support owned snapshot transactions');
      }
      transaction = await client.beginTransaction({
        isolationLevel: 'repeatable read',
        readOnly: true,
      });
      await transaction.raw('SET LOCAL idle_in_transaction_session_timeout = 0');
      const rows = normalizeRawRows<{ snapshotId?: string; snapshot_id?: string }>(
        await transaction.raw('SELECT pg_export_snapshot() AS "snapshotId"')
      );
      const snapshotId = rows[0]?.snapshotId ?? rows[0]?.snapshot_id;
      if (!snapshotId) {
        throw new Error('PostgreSQL did not return an exported snapshot id');
      }
      return { client, transaction, snapshotId, openedAt: new Date().toISOString() };
    } catch (error) {
      await transaction?.rollback().catch(() => undefined);
      await client.destroy().catch(() => undefined);
      throw error;
    }
  }

  private async closeSourceSnapshot(snapshot: ISourceSnapshotHandle | null) {
    if (!snapshot) {
      return;
    }
    try {
      await snapshot.transaction.rollback();
    } finally {
      await snapshot.client.destroy().catch(() => undefined);
    }
  }

  private async installSourceDeltaCaptureForJob(
    job: IMigrationJobRecord,
    sourceDataDb: IResolvedDataDatabase
  ) {
    const inventory = this.normalizeInventory(job.inventory, job.spaceId);
    const sourceSchema = this.getSourceSchema(sourceDataDb);
    const triggerName = this.deltaTriggerName(job.id);
    const client = this.clientFactory(sourceDataDb.url);
    try {
      await client.raw(`
        CREATE TABLE IF NOT EXISTS ${qualify(sourceSchema, deltaLogTable)} (
          "seq" bigserial PRIMARY KEY,
          "job_id" text NOT NULL,
          "txid" bigint NOT NULL,
          "schema_name" text NOT NULL,
          "table_name" text NOT NULL,
          "op" text NOT NULL,
          "pk" jsonb,
          "old_row" jsonb,
          "new_row" jsonb,
          "captured_at" timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ${quoteIdent(`${deltaLogTable}_job_seq_idx`)}
          ON ${qualify(sourceSchema, deltaLogTable)} ("job_id", "seq");
        CREATE OR REPLACE FUNCTION ${qualify(sourceSchema, deltaCaptureFunction)}()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
          old_payload jsonb;
          new_payload jsonb;
          pk_text text;
        BEGIN
          IF TG_OP = 'INSERT' THEN
            new_payload := to_jsonb(NEW);
          ELSIF TG_OP = 'UPDATE' THEN
            old_payload := to_jsonb(OLD);
            new_payload := to_jsonb(NEW);
          ELSIF TG_OP = 'DELETE' THEN
            old_payload := to_jsonb(OLD);
          END IF;

          pk_text := COALESCE(
            new_payload ->> '__id',
            old_payload ->> '__id',
            new_payload ->> 'id',
            old_payload ->> 'id'
          );

          INSERT INTO ${qualify(sourceSchema, deltaLogTable)} (
            "job_id",
            "txid",
            "schema_name",
            "table_name",
            "op",
            "pk",
            "old_row",
            "new_row"
          )
          VALUES (
            TG_ARGV[0],
            txid_current(),
            TG_TABLE_SCHEMA,
            TG_TABLE_NAME,
            TG_OP,
            CASE WHEN pk_text IS NULL THEN NULL ELSE jsonb_build_object('id', pk_text) END,
            old_payload,
            new_payload
          );

          RETURN NULL;
        END;
        $$;
      `);

      for (const relation of this.getDeltaCaptureRelations(inventory, sourceSchema)) {
        await client.raw(
          `
            DROP TRIGGER IF EXISTS ${quoteIdent(triggerName)} ON ${qualify(
              relation.schemaName,
              relation.tableName
            )};
            CREATE TRIGGER ${quoteIdent(triggerName)}
            AFTER INSERT OR UPDATE OR DELETE ON ${qualify(relation.schemaName, relation.tableName)}
            FOR EACH ROW
            EXECUTE FUNCTION ${qualify(sourceSchema, deltaCaptureFunction)}(${sqlLiteral(job.id)});
          `
        );
      }

      await this.migrationJobClient.spaceDataDbMigrationJob.update({
        where: { id: job.id },
        data: {
          copyStats: {
            ...(this.asRecord(job.copyStats) ?? {}),
            phase: 'source_delta_capture_installed',
            progress: this.buildMigrationProgress(job, inventory, 'source_delta_capture_installed'),
            delta: {
              triggerName,
              relationCount: this.getDeltaCaptureRelations(inventory, sourceSchema).length,
              sourceSchema,
              installedAt: new Date().toISOString(),
            },
          },
          lastError: null,
        },
      });
    } finally {
      await client.destroy().catch(() => undefined);
    }
  }

  private async cleanupSourceDeltaCaptureForJob(job: IMigrationJobRecord) {
    const sourceDataDb = await this.getSourceDataDbForJob(job).catch(() => null);
    if (!sourceDataDb) {
      return;
    }
    const inventory = this.normalizeInventory(job.inventory, job.spaceId);
    const sourceSchema = this.getSourceSchema(sourceDataDb);
    const triggerName = this.deltaTriggerName(job.id);
    const client = this.clientFactory(sourceDataDb.url);
    try {
      for (const relation of this.getDeltaCaptureRelations(inventory, sourceSchema)) {
        await client
          .raw(
            `DROP TRIGGER IF EXISTS ${quoteIdent(triggerName)} ON ${qualify(
              relation.schemaName,
              relation.tableName
            )}`
          )
          .catch(() => undefined);
      }
      await client
        .raw(`DELETE FROM ${qualify(sourceSchema, deltaLogTable)} WHERE "job_id" = ?`, [job.id])
        .catch(() => undefined);
    } finally {
      await client.destroy().catch(() => undefined);
    }
  }

  private async getSourceDeltaMaxSeq(
    client: IDataDbPreflightClient,
    sourceSchema: string,
    jobId: string
  ) {
    const rows = normalizeRawRows<{ maxSeq: string | number | bigint | null }>(
      await client.raw(
        `SELECT COALESCE(MAX("seq"), 0) AS "maxSeq" FROM ${qualify(
          sourceSchema,
          deltaLogTable
        )} WHERE "job_id" = ?`,
        [jobId]
      )
    );
    return Number(rows[0]?.maxSeq ?? 0);
  }

  private async tryGetSourceDeltaMaxSeq(
    client: IDataDbPreflightClient,
    sourceSchema: string,
    jobId: string
  ) {
    try {
      return await this.getSourceDeltaMaxSeq(client, sourceSchema, jobId);
    } catch {
      return null;
    }
  }

  private async listSourceDeltaRows(input: {
    client: IDataDbPreflightClient;
    sourceSchema: string;
    jobId: string;
    afterSeq: number;
    targetSeq: number;
    limit: number;
  }) {
    return normalizeRawRows<ISourceDeltaRow>(
      await input.client.raw(
        `
          SELECT
            "seq",
            "schema_name" AS "schemaName",
            "table_name" AS "tableName",
            "op",
            "pk",
            "old_row" AS "oldRow",
            "new_row" AS "newRow",
            "captured_at" AS "capturedAt"
          FROM ${qualify(input.sourceSchema, deltaLogTable)}
          WHERE "job_id" = ?
            AND "seq" > ?
            AND "seq" <= ?
          ORDER BY "seq" ASC
          LIMIT ?
        `,
        [input.jobId, input.afterSeq, input.targetSeq, input.limit]
      )
    );
  }

  private parseDeltaPayload(value: unknown): Record<string, unknown> | null {
    if (typeof value === 'string') {
      try {
        return this.asRecord(JSON.parse(value));
      } catch {
        return null;
      }
    }
    return this.asRecord(value);
  }

  private deltaRowPayload(row: ISourceDeltaRow) {
    return this.parseDeltaPayload(row.op === 'DELETE' ? row.oldRow : row.newRow);
  }

  private shouldReplayDeltaRow(
    row: ISourceDeltaRow,
    inventory: ISpaceDataDbInventory,
    sourceSchema: string
  ) {
    if (row.schemaName !== sourceSchema) {
      return inventory.baseIds.includes(row.schemaName);
    }

    const payload = this.deltaRowPayload(row);
    if (!payload) {
      return false;
    }

    const tableScopeIds = new Set(
      inventory.sharedTableIds.length ? inventory.sharedTableIds : inventory.tableIds
    );
    const baseIds = new Set(inventory.baseIds);
    const copySpaceIds = new Set(this.getInventoryCopySpaceIds(inventory));

    if (
      row.tableName === sharedTables.recordHistory ||
      row.tableName === sharedTables.tableTrash ||
      row.tableName === sharedTables.recordTrash
    ) {
      return typeof payload.table_id === 'string' && tableScopeIds.has(payload.table_id);
    }
    if (
      row.tableName === sharedTables.computedUpdateOutbox ||
      row.tableName === sharedTables.computedUpdateDeadLetter
    ) {
      return typeof payload.base_id === 'string' && baseIds.has(payload.base_id);
    }
    if (row.tableName === sharedTables.computedUpdateOutboxSeed) {
      return typeof payload.table_id === 'string' && inventory.tableIds.includes(payload.table_id);
    }
    if (row.tableName === sharedTables.computedUpdatePauseScope) {
      const scopeType = payload.scope_type;
      const scopeId = payload.scope_id;
      return (
        (scopeType === 'space' && typeof scopeId === 'string' && copySpaceIds.has(scopeId)) ||
        (scopeType === 'base' && typeof scopeId === 'string' && baseIds.has(scopeId)) ||
        (scopeType === 'table' && typeof scopeId === 'string' && tableScopeIds.has(scopeId))
      );
    }
    if (row.tableName === sharedTables.undoLog) {
      const tableName = typeof payload.table_name === 'string' ? payload.table_name : '';
      return baseIds.has(tableName.split('.')[0] ?? '');
    }
    return false;
  }

  private targetSchemaForDeltaRow(
    row: ISourceDeltaRow,
    sourceSchema: string,
    targetSchema: string
  ) {
    return row.schemaName === sourceSchema ? targetSchema : row.schemaName;
  }

  private primaryKeyColumn(payload: Record<string, unknown>) {
    if (Object.prototype.hasOwnProperty.call(payload, '__id')) {
      return '__id';
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'id')) {
      return 'id';
    }
    return null;
  }

  private async applyDeltaRowToTarget(input: {
    targetClient: IDataDbPreflightClient;
    row: ISourceDeltaRow;
    sourceSchema: string;
    targetSchema: string;
    jsonColumnCache?: Map<string, Set<string>>;
  }) {
    const payload = this.deltaRowPayload(input.row);
    if (!payload) {
      return false;
    }
    const pkColumn = this.primaryKeyColumn(payload);
    if (!pkColumn) {
      return false;
    }
    const pkValue = payload[pkColumn];
    const qualified = qualify(
      this.targetSchemaForDeltaRow(input.row, input.sourceSchema, input.targetSchema),
      input.row.tableName
    );

    if (input.row.op === 'DELETE') {
      await input.targetClient.raw(`DELETE FROM ${qualified} WHERE ${quoteIdent(pkColumn)} = ?`, [
        pkValue,
      ]);
      return true;
    }

    const columns = Object.keys(payload);
    if (!columns.length) {
      return false;
    }
    const targetSchema = this.targetSchemaForDeltaRow(
      input.row,
      input.sourceSchema,
      input.targetSchema
    );
    const jsonColumns = await this.getDeltaReplayJsonColumns(
      input.targetClient,
      targetSchema,
      input.row.tableName,
      input.jsonColumnCache
    );
    const updateColumns = columns.filter((column) => column !== pkColumn);
    const insertSql = [
      `INSERT INTO ${qualified} (${columns.map(quoteIdent).join(', ')})`,
      `VALUES (${columns.map(() => '?').join(', ')})`,
      `ON CONFLICT (${quoteIdent(pkColumn)})`,
      updateColumns.length
        ? `DO UPDATE SET ${updateColumns
            .map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`)
            .join(', ')}`
        : 'DO NOTHING',
    ].join(' ');
    await input.targetClient.raw(
      insertSql,
      columns.map((column) => {
        const value = payload[column];
        return jsonColumns.has(column) && value != null ? JSON.stringify(value) : value;
      })
    );
    return true;
  }

  private async getDeltaReplayJsonColumns(
    targetClient: IDataDbPreflightClient,
    schemaName: string,
    tableName: string,
    cache?: Map<string, Set<string>>
  ) {
    const cacheKey = `${schemaName}.${tableName}`;
    const cached = cache?.get(cacheKey);
    if (cached) {
      return cached;
    }

    const rows = normalizeRawRows<{ columnName: string }>(
      await targetClient.raw(
        `
          SELECT "column_name" AS "columnName"
          FROM information_schema.columns
          WHERE "table_schema" = ?
            AND "table_name" = ?
            AND "data_type" IN ('json', 'jsonb')
        `,
        [schemaName, tableName]
      )
    );
    const jsonColumns = new Set(rows.map((row) => row.columnName));
    cache?.set(cacheKey, jsonColumns);
    return jsonColumns;
  }

  private async updateDeltaReplayStats(job: IMigrationJobRecord, stats: IDeltaReplayStats) {
    const inventory = this.normalizeInventory(job.inventory, job.spaceId);
    await this.migrationJobClient.spaceDataDbMigrationJob
      .update({
        where: { id: job.id },
        data: {
          copyStats: {
            ...(this.asRecord(job.copyStats) ?? {}),
            phase: stats.phase,
            progress: this.buildMigrationProgress(
              job,
              inventory,
              stats.phase,
              this.deltaReplayProgressDetail(stats)
            ),
            delta: stats,
          },
          lastError: null,
        },
      })
      .catch(() => undefined);
  }

  private deltaReplayProgressDetail(
    stats: IDeltaReplayStats
  ): ISpaceDataDbMigrationProgressDetail | undefined {
    if (stats.lastCapturedSeq <= 0) {
      return undefined;
    }
    const seqFraction = Math.min(Math.max(stats.lastReplayedSeq / stats.lastCapturedSeq, 0), 1);
    // The first replay pass covers the front of the delta stage; the cutover
    // pass after the final write gate covers the tail.
    if (stats.phase === 'delta_replaying') {
      return { stageFraction: Math.min(0.6 * seqFraction, 0.59) };
    }
    if (stats.phase === 'delta_cutover_replaying') {
      return { stageFraction: Math.min(0.6 + 0.3 * seqFraction, 0.89) };
    }
    return undefined;
  }

  private async replayDeltaForJob(
    jobId: string,
    options: {
      targetSeq?: number;
      phase?: string;
      timeoutMs?: number;
      batchSize?: number;
      lagThreshold?: number;
    } = {}
  ): Promise<IDeltaReplayStats> {
    const job = await this.getMigrationJob(jobId);
    if (!job.targetConnection?.encryptedUrl) {
      throw new CustomHttpException(
        `Migration job ${jobId} has no target connection`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    const inventory = this.normalizeInventory(job.inventory, job.spaceId);
    const sourceDataDb = await this.getSourceDataDbForJob(job);
    const sourceSchema = this.getSourceSchema(sourceDataDb);
    const targetUrl = decryptDataDbUrl(job.targetConnection.encryptedUrl);
    const sourceClient = this.clientFactory(sourceDataDb.url);
    const targetClient = this.clientFactory(targetUrl);
    const batchSize =
      options.batchSize ??
      readPositiveIntEnv(
        'BYODB_SPACE_DATA_DB_DELTA_REPLAY_BATCH_SIZE',
        defaultDeltaReplayBatchSize
      );
    const lagThreshold =
      options.lagThreshold ??
      readNonNegativeIntEnv(
        'BYODB_SPACE_DATA_DB_DELTA_REPLAY_LAG_THRESHOLD',
        defaultDeltaReplayLagThreshold
      );
    const timeoutMs =
      options.timeoutMs ??
      readPositiveIntEnv(
        'BYODB_SPACE_DATA_DB_DELTA_REPLAY_CATCHUP_TIMEOUT_MS',
        defaultDeltaReplayCatchupTimeoutMs
      );
    const phase = options.phase ?? 'delta_replaying';
    const startedAt = new Date().toISOString();
    const deadline = Date.now() + timeoutMs;
    let rowsApplied = 0;
    const jsonColumnCache = new Map<string, Set<string>>();
    const existingDeltaStats = this.asRecord(this.asRecord(job.copyStats)?.delta);
    const existingLastReplayedSeq = Number(existingDeltaStats?.lastReplayedSeq ?? 0);
    let lastReplayedSeq = Number.isFinite(existingLastReplayedSeq) ? existingLastReplayedSeq : 0;
    let lastCapturedSeq = await this.getSourceDeltaMaxSeq(sourceClient, sourceSchema, jobId);

    try {
      while (true) {
        await this.assertMigrationNotCanceled(jobId);
        lastCapturedSeq =
          options.targetSeq ?? (await this.getSourceDeltaMaxSeq(sourceClient, sourceSchema, jobId));
        const rows = await this.listSourceDeltaRows({
          client: sourceClient,
          sourceSchema,
          jobId,
          afterSeq: lastReplayedSeq,
          targetSeq: lastCapturedSeq,
          limit: batchSize,
        });

        for (const row of rows) {
          const seq = Number(row.seq);
          if (this.shouldReplayDeltaRow(row, inventory, sourceSchema)) {
            const applied = await this.applyDeltaRowToTarget({
              targetClient,
              row,
              sourceSchema,
              targetSchema: job.targetInternalSchema,
              jsonColumnCache,
            });
            if (applied) {
              rowsApplied += 1;
            }
          }
          if (Number.isFinite(seq)) {
            lastReplayedSeq = Math.max(lastReplayedSeq, seq);
          }
        }

        const lag = Math.max(0, lastCapturedSeq - lastReplayedSeq);
        const stats: IDeltaReplayStats = {
          phase,
          lastCapturedSeq,
          lastReplayedSeq,
          lag,
          rowsApplied,
          startedAt,
          updatedAt: new Date().toISOString(),
        };
        await this.updateDeltaReplayStats(job, stats);

        if (lag <= lagThreshold) {
          const completedStats = {
            ...stats,
            phase: 'delta_replayed',
            completedAt: new Date().toISOString(),
          };
          await this.updateDeltaReplayStats(job, completedStats);
          return completedStats;
        }
        if (Date.now() > deadline) {
          throw new Error(
            `Timed out replaying source delta for migration job ${jobId}; lag=${lag}, lastCapturedSeq=${lastCapturedSeq}, lastReplayedSeq=${lastReplayedSeq}`
          );
        }
        await delay(250);
      }
    } finally {
      await Promise.all([
        sourceClient.destroy().catch(() => undefined),
        targetClient.destroy().catch(() => undefined),
      ]);
    }
  }

  async assertPostgresCopyToolsAvailableForJob(
    jobId: string,
    options: {
      timeoutMs?: number;
      baseSchemaCopyStrategy?: ISpaceDataDbBaseSchemaCopyStrategy;
    } = {}
  ) {
    const baseSchemaCopyStrategy = options.baseSchemaCopyStrategy ?? 'pg_dump_stream_restore';
    const requiredTools = postgresCopyToolsForStrategy(baseSchemaCopyStrategy);
    const startedAt = new Date().toISOString();
    await this.migrationJobClient.spaceDataDbMigrationJob.update({
      where: { id: jobId },
      data: {
        copyStats: {
          phase: 'postgres_tools_checking',
          postgresTools: {
            requiredTools,
            startedAt,
          },
        },
        lastError: null,
      },
    });

    try {
      const results = await this.copyService.assertPostgresToolsAvailable(
        baseSchemaCopyStrategy,
        this.buildCancelableProcessOptions(
          jobId,
          Math.min(
            options.timeoutMs ?? defaultPostgresToolCheckTimeoutMs,
            defaultPostgresToolCheckTimeoutMs
          )
        )
      );
      const copyStats = {
        phase: 'postgres_tools_checked',
        postgresTools: {
          requiredTools,
          results,
          startedAt,
          completedAt: new Date().toISOString(),
        },
      };
      await this.migrationJobClient.spaceDataDbMigrationJob.update({
        where: { id: jobId },
        data: {
          copyStats,
          lastError: null,
        },
      });
      return copyStats;
    } catch (error) {
      if (await this.isProcessCancelErrorForJob(error, jobId)) {
        throw error;
      }
      const lastError = this.buildProcessFailureMessage(error);
      await this.migrationJobClient.spaceDataDbMigrationJob.update({
        where: { id: jobId },
        data: {
          state: 'failed',
          lastError,
          copyStats: {
            phase: 'postgres_tools_unavailable',
            postgresTools: {
              requiredTools,
              startedAt,
              failedAt: new Date().toISOString(),
              error: lastError,
              failure: this.buildProcessFailureStats(error),
            },
          },
        },
      });
      throw new CustomHttpException(
        'Required PostgreSQL client tools are unavailable for space data DB migration',
        HttpErrorCode.VALIDATION_ERROR,
        {
          errorCode: spaceDataDbPostgresToolUnavailableErrorCode,
          migrationJobId: jobId,
          requiredTools,
          cause: lastError,
        }
      );
    }
  }

  private async updateBaseSchemaCopyProgress(input: {
    job: IMigrationJobRecord;
    inventory: ISpaceDataDbInventory;
    schemaNames: string[];
    strategy: ISpaceDataDbBaseSchemaCopyStrategy;
    progressPollMs: number;
    startedAt: string;
    phase: IBaseSchemaCopyProgressPhase;
    client: IDataDbPreflightClient;
  }) {
    await this.updateBaseSchemaCopyHeartbeat(input.job, input, {
      stage: 'progress_poll',
      phase: input.phase,
      updatedAt: new Date().toISOString(),
    });

    const activeCopy = await this.inspectBaseSchemaActiveCopyProgress(
      input.client,
      input.inventory,
      input.schemaNames,
      input.phase
    ).catch((error) => ({
      phase: input.phase,
      sampledAt: new Date().toISOString(),
      activeRelationCount: 0,
      activeRelations: [],
      error: error instanceof Error ? error.message : String(error),
    }));

    // Only the restore client points at the target database, where cumulative
    // relation sizes reflect how much data has actually landed.
    const copiedBytes =
      input.phase === 'restore'
        ? await this.sampleTargetSchemaCopiedBytes(input.client, input.schemaNames)
        : null;
    const progressDetail: ISpaceDataDbMigrationProgressDetail | undefined =
      copiedBytes != null
        ? {
            copiedBytes,
            ...(input.inventory.estimatedTotalBytes > 0
              ? {
                  stageFraction: Math.min(copiedBytes / input.inventory.estimatedTotalBytes, 0.99),
                }
              : {}),
          }
        : undefined;

    await this.migrationJobClient.spaceDataDbMigrationJob
      .update({
        where: { id: input.job.id },
        data: {
          state: 'copying',
          copyStats: {
            phase: 'copying_base_schemas',
            progress: this.buildMigrationProgress(
              input.job,
              input.inventory,
              'copying_base_schemas',
              progressDetail
            ),
            baseSchemas: {
              schemaNames: input.schemaNames,
              strategy: input.strategy,
              progressPollMs: input.progressPollMs,
              startedAt: input.startedAt,
              activeCopy,
              heartbeat: {
                stage: 'progress_poll',
                phase: input.phase,
                updatedAt: activeCopy.sampledAt,
              },
              progressUpdatedAt: activeCopy.sampledAt,
            },
          },
          lastError: null,
        },
      })
      .catch(() => undefined);
  }

  private async inspectBaseSchemaActiveCopyProgress(
    client: IDataDbPreflightClient,
    inventory: ISpaceDataDbInventory,
    schemaNames: string[],
    phase: IBaseSchemaCopyProgressPhase
  ): Promise<IBaseSchemaActiveCopyProgress> {
    const sampledAt = new Date().toISOString();
    if (!schemaNames.length) {
      return {
        phase,
        sampledAt,
        activeRelationCount: 0,
        activeRelations: [],
      };
    }

    const rows = normalizeRawRows<{
      schemaName: string;
      relationName: string;
      command: string | null;
      copyType: string | null;
      bytesProcessed: string | number | bigint | null;
      bytesTotal: string | number | bigint | null;
      tuplesProcessed: string | number | bigint | null;
      tuplesExcluded: string | number | bigint | null;
    }>(
      await client.raw(
        `
          SELECT
            n.nspname AS "schemaName",
            c.relname AS "relationName",
            p.command AS "command",
            p.type AS "copyType",
            p.bytes_processed AS "bytesProcessed",
            p.bytes_total AS "bytesTotal",
            p.tuples_processed AS "tuplesProcessed",
            p.tuples_excluded AS "tuplesExcluded"
          FROM pg_stat_progress_copy p
          JOIN pg_class c ON c.oid = p.relid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ANY(?::text[])
          ORDER BY n.nspname ASC, c.relname ASC, p.pid ASC
        `,
        [schemaNames]
      )
    );
    const relationStats = new Map(
      inventory.physicalSchemas
        .flatMap((schema) => schema.relations)
        .map((relation) => [`${relation.schemaName}.${relation.relationName}`, relation] as const)
    );
    const activeRelations = rows.map((row) => {
      const relation = relationStats.get(`${row.schemaName}.${row.relationName}`);
      return {
        schemaName: row.schemaName,
        relationName: row.relationName,
        command: row.command ?? null,
        copyType: row.copyType ?? null,
        bytesProcessed: this.toNullableNumber(row.bytesProcessed),
        bytesTotal: this.toNullableNumber(row.bytesTotal),
        tuplesProcessed: this.toNullableNumber(row.tuplesProcessed),
        tuplesExcluded: this.toNullableNumber(row.tuplesExcluded),
        estimatedRows: relation?.estimatedRows ?? null,
        totalBytes: relation?.totalBytes ?? null,
      };
    });

    return {
      phase,
      sampledAt,
      activeRelationCount: activeRelations.length,
      activeRelations,
    };
  }

  private async sampleTargetSchemaCopiedBytes(
    client: IDataDbPreflightClient,
    schemaNames: string[]
  ): Promise<number | null> {
    if (!schemaNames.length) {
      return null;
    }
    try {
      const rows = normalizeRawRows<{ copiedBytes: string | number | bigint | null }>(
        await client.raw(
          `
            SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0) AS "copiedBytes"
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = ANY(?::text[]) AND c.relkind IN ('r', 'p', 'm', 't')
          `,
          [schemaNames]
        )
      );
      return this.toNullableNumber(rows[0]?.copiedBytes ?? null);
    } catch {
      return null;
    }
  }

  private async installTargetPublicUndoCaptureCompatibility(targetUrl: string) {
    const client = this.clientFactory(targetUrl);
    try {
      await client.raw(`
        CREATE SCHEMA IF NOT EXISTS "public";
        CREATE OR REPLACE FUNCTION "public"."__teable_capture_undo_row"()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
          batch_id text;
          captured_record_id text;
          captured_old_row jsonb;
          captured_new_row jsonb;
        BEGIN
          batch_id := current_setting('teable.undo_batch_id', true);

          IF TG_OP = 'INSERT' THEN
            captured_record_id := COALESCE(NEW."__id"::text, '');
            captured_new_row := to_jsonb(NEW);
          ELSIF TG_OP = 'UPDATE' THEN
            captured_record_id := COALESCE(NEW."__id"::text, OLD."__id"::text, '');
            captured_old_row := to_jsonb(OLD);
            captured_new_row := to_jsonb(NEW);
          ELSIF TG_OP = 'DELETE' THEN
            captured_record_id := COALESCE(OLD."__id"::text, '');
            captured_old_row := to_jsonb(OLD);
          END IF;

          IF batch_id IS NULL OR batch_id = '' THEN
            RETURN NULL;
          END IF;

          INSERT INTO "__undo_log" (
            "batch_id",
            "operation",
            "table_name",
            "record_id",
            "old_row",
            "new_row"
          )
          VALUES (
            batch_id,
            TG_OP,
            TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
            captured_record_id,
            captured_old_row,
            captured_new_row
          );

          RETURN NULL;
        END;
        $$;
      `);
    } finally {
      await client.destroy().catch(() => undefined);
    }
  }

  private async inspectBaseSchemaCopyRows(
    targetUrl: string,
    inventory: ISpaceDataDbInventory
  ): Promise<IBaseSchemaRelationCopySummary[]> {
    const client = this.clientFactory(targetUrl);
    try {
      const summaries: IBaseSchemaRelationCopySummary[] = [];
      const relations = inventory.physicalSchemas.flatMap((schema) => schema.relations);
      for (const relation of relations) {
        if (!relationKindsWithRows.has(relation.relationKind)) {
          continue;
        }
        summaries.push({
          schemaName: relation.schemaName,
          relationName: relation.relationName,
          relationKind: relation.relationKind,
          copiedRows: await this.countRows(client, relation.schemaName, relation.relationName),
          estimatedRows: relation.estimatedRows,
          totalBytes: relation.totalBytes,
        });
      }
      return summaries.sort(
        (left, right) =>
          left.schemaName.localeCompare(right.schemaName) ||
          left.relationName.localeCompare(right.relationName)
      );
    } finally {
      await client.destroy().catch(() => undefined);
    }
  }

  private async withMigrationHeartbeat<T>(
    heartbeat: () => Promise<void>,
    task: () => Promise<T>,
    intervalMs: number
  ): Promise<T> {
    let active = true;
    const heartbeatState: { inFlight: Promise<void> | null } = { inFlight: null };
    const runHeartbeat = () => {
      if (!active || heartbeatState.inFlight) {
        return heartbeatState.inFlight;
      }
      heartbeatState.inFlight = heartbeat()
        .catch(() => undefined)
        .finally(() => {
          heartbeatState.inFlight = null;
        });
      return heartbeatState.inFlight;
    };

    await runHeartbeat();
    const timer = setInterval(
      () => {
        void runHeartbeat();
      },
      Math.max(1, Math.floor(intervalMs))
    );
    try {
      return await task();
    } finally {
      active = false;
      clearInterval(timer);
      const lastHeartbeat = heartbeatState.inFlight;
      if (lastHeartbeat) {
        await lastHeartbeat.catch(() => undefined);
      }
    }
  }

  private resolveRunMigrationJobOptions(
    jobId: string,
    options: IRunMigrationJobOptions
  ): IResolvedRunMigrationJobOptions {
    const requestedJobs =
      options.jobs ?? readPositiveIntEnv('BYODB_SPACE_DATA_DB_COPY_JOBS', defaultMigrationCopyJobs);
    const maxJobs =
      options.maxJobs ??
      readPositiveIntEnv('BYODB_SPACE_DATA_DB_COPY_MAX_JOBS', defaultMigrationCopyMaxJobs);
    return {
      workDir: options.workDir ?? path.join(tmpdir(), 'teable-space-data-db-migrations', jobId),
      jobs: Math.min(Math.max(1, Math.floor(requestedJobs)), Math.max(1, Math.floor(maxJobs))),
      maxJobs,
      baseSchemaCopyStrategy:
        options.baseSchemaCopyStrategy ??
        readBaseSchemaCopyStrategyEnv(
          'BYODB_SPACE_DATA_DB_BASE_SCHEMA_COPY_STRATEGY',
          'pg_dump_stream_restore'
        ),
      sharedTableCopyStrategy:
        options.sharedTableCopyStrategy ??
        readSharedTableCopyStrategyEnv(
          'BYODB_SPACE_DATA_DB_SHARED_TABLE_COPY_STRATEGY',
          'psql_copy'
        ),
      timeoutMs: optionOrPositiveIntEnv(
        options.timeoutMs,
        'BYODB_SPACE_DATA_DB_COPY_TIMEOUT_MS',
        defaultMigrationCopyTimeoutMs
      ),
      computedDrainTimeoutMs: optionOrPositiveIntEnv(
        options.computedDrainTimeoutMs,
        'BYODB_SPACE_DATA_DB_COMPUTED_DRAIN_TIMEOUT_MS',
        defaultComputedDrainTimeoutMs
      ),
      computedDrainPollMs: optionOrPositiveIntEnv(
        options.computedDrainPollMs,
        'BYODB_SPACE_DATA_DB_COMPUTED_DRAIN_POLL_MS',
        defaultComputedDrainPollMs
      ),
      computedProcessingLeaseMs: optionOrPositiveIntEnv(
        options.computedProcessingLeaseMs,
        'BYODB_SPACE_DATA_DB_COMPUTED_PROCESSING_LEASE_MS',
        defaultComputedProcessingLeaseMs
      ),
      schemaOperationDrainTimeoutMs: optionOrPositiveIntEnv(
        options.schemaOperationDrainTimeoutMs,
        'BYODB_SPACE_DATA_DB_SCHEMA_OPERATION_DRAIN_TIMEOUT_MS',
        defaultSchemaOperationDrainTimeoutMs
      ),
      schemaOperationDrainPollMs: optionOrPositiveIntEnv(
        options.schemaOperationDrainPollMs,
        'BYODB_SPACE_DATA_DB_SCHEMA_OPERATION_DRAIN_POLL_MS',
        defaultSchemaOperationDrainPollMs
      ),
      backgroundWriterDrainTimeoutMs: optionOrPositiveIntEnv(
        options.backgroundWriterDrainTimeoutMs,
        'BYODB_SPACE_DATA_DB_BACKGROUND_WRITER_DRAIN_TIMEOUT_MS',
        defaultBackgroundWriterDrainTimeoutMs
      ),
      backgroundWriterDrainPollMs: optionOrPositiveIntEnv(
        options.backgroundWriterDrainPollMs,
        'BYODB_SPACE_DATA_DB_BACKGROUND_WRITER_DRAIN_POLL_MS',
        defaultBackgroundWriterDrainPollMs
      ),
      backgroundWriterDrainProbeTimeoutMs: optionOrPositiveIntEnv(
        options.backgroundWriterDrainProbeTimeoutMs,
        'BYODB_SPACE_DATA_DB_BACKGROUND_WRITER_DRAIN_PROBE_TIMEOUT_MS',
        defaultBackgroundWriterDrainProbeTimeoutMs
      ),
      backgroundWriterQueueScanBatchSize: optionOrPositiveIntEnv(
        options.backgroundWriterQueueScanBatchSize,
        'BYODB_SPACE_DATA_DB_BACKGROUND_WRITER_QUEUE_SCAN_BATCH_SIZE',
        defaultBackgroundWriterQueueScanBatchSize
      ),
      backgroundWriterQueueScanLimit: optionOrPositiveIntEnv(
        options.backgroundWriterQueueScanLimit,
        'BYODB_SPACE_DATA_DB_BACKGROUND_WRITER_QUEUE_SCAN_LIMIT',
        defaultBackgroundWriterQueueScanLimit
      ),
      tempDiskMultiplier: optionOrPositiveNumberEnv(
        options.tempDiskMultiplier,
        'BYODB_SPACE_DATA_DB_TEMP_DISK_MULTIPLIER',
        defaultTempDiskMultiplier
      ),
      tempDiskMinFreeBytes: optionOrPositiveIntEnv(
        options.tempDiskMinFreeBytes,
        'BYODB_SPACE_DATA_DB_TEMP_DISK_MIN_FREE_BYTES',
        defaultTempDiskMinFreeBytes
      ),
    };
  }

  async waitForSchemaOperationsForJob(
    jobId: string,
    options: { timeoutMs?: number; pollMs?: number; staleNonTerminalMs?: number } = {}
  ): Promise<ISchemaOperationDrainStats> {
    const timeoutMs = Math.max(
      0,
      Math.floor(options.timeoutMs ?? defaultSchemaOperationDrainTimeoutMs)
    );
    const pollMs = Math.max(1, Math.floor(options.pollMs ?? defaultSchemaOperationDrainPollMs));
    const staleNonTerminalMs = optionOrPositiveIntEnv(
      options.staleNonTerminalMs,
      'SPACE_DATA_DB_MIGRATION_DRAIN_STALE_NON_TERMINAL_MS',
      defaultDrainStaleNonTerminalMs
    );
    const startedAt = Date.now();
    const job = await this.getMigrationJob(jobId);
    const inventory = this.normalizeInventory(job.inventory, job.spaceId);

    if (!inventory.baseIds.length && !inventory.tableIds.length) {
      const drained = this.buildSchemaOperationDrainStats(0, []);
      await this.updateSchemaOperationDrainStats(
        job,
        inventory,
        'schema_operations_drained',
        drained
      );
      return drained;
    }

    await this.updateSchemaOperationDrainStats(
      job,
      inventory,
      'schema_operations_draining',
      this.buildSchemaOperationDrainStats(0, [])
    );

    try {
      for (;;) {
        await this.assertMigrationNotCanceled(jobId, job.spaceId);
        const stats = await this.inspectSchemaOperationDrain(
          inventory,
          new Date(Date.now() - staleNonTerminalMs)
        );
        if (stats.openCount === 0) {
          await this.updateSchemaOperationDrainStats(
            job,
            inventory,
            'schema_operations_drained',
            stats
          );
          return stats;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          const lastError = `Timed out waiting for schema operations to drain for migration job ${jobId}`;
          await this.migrationJobClient.spaceDataDbMigrationJob.update({
            where: { id: jobId },
            data: {
              state: 'failed',
              lastError,
              copyStats: {
                phase: 'schema_operation_drain_timeout',
                progress: this.buildMigrationProgress(
                  job,
                  inventory,
                  'schema_operation_drain_timeout'
                ),
                schemaOperations: stats,
              },
            },
          });
          throw new CustomHttpException(lastError, HttpErrorCode.CONFLICT, {
            errorCode: spaceDataDbSchemaOperationDrainTimeoutErrorCode,
            openCount: stats.openCount,
            spaceId: job.spaceId,
            migrationJobId: jobId,
          });
        }

        await this.updateSchemaOperationDrainStats(
          job,
          inventory,
          'schema_operations_draining',
          stats
        );
        await delay(pollMs);
      }
    } catch (error) {
      if (error instanceof CustomHttpException) {
        throw error;
      }
      const lastError = this.buildProcessFailureMessage(error);
      await this.migrationJobClient.spaceDataDbMigrationJob.update({
        where: { id: jobId },
        data: {
          state: 'failed',
          lastError,
          copyStats: {
            phase: 'schema_operation_drain_failed',
            progress: this.buildMigrationProgress(job, inventory, 'schema_operation_drain_failed'),
            schemaOperations: {
              failedAt: new Date().toISOString(),
            },
          },
        },
      });
      throw error;
    }
  }

  async waitForBackgroundWritersForJob(
    jobId: string,
    options: {
      timeoutMs?: number;
      pollMs?: number;
      probeTimeoutMs?: number;
      queueScanBatchSize?: number;
      queueScanLimit?: number;
      staleNonTerminalMs?: number;
    } = {}
  ): Promise<IBackgroundWriterDrainStats> {
    const timeoutMs = Math.max(
      0,
      Math.floor(options.timeoutMs ?? defaultBackgroundWriterDrainTimeoutMs)
    );
    const pollMs = Math.max(1, Math.floor(options.pollMs ?? defaultBackgroundWriterDrainPollMs));
    const probeTimeoutMs = Math.max(
      0,
      Math.floor(options.probeTimeoutMs ?? defaultBackgroundWriterDrainProbeTimeoutMs)
    );
    const queueScanBatchSize = Math.max(
      1,
      Math.floor(options.queueScanBatchSize ?? defaultBackgroundWriterQueueScanBatchSize)
    );
    const queueScanLimit = Math.max(
      1,
      Math.floor(options.queueScanLimit ?? defaultBackgroundWriterQueueScanLimit)
    );
    const staleNonTerminalMs = optionOrPositiveIntEnv(
      options.staleNonTerminalMs,
      'SPACE_DATA_DB_MIGRATION_DRAIN_STALE_NON_TERMINAL_MS',
      defaultDrainStaleNonTerminalMs
    );
    const startedAt = Date.now();
    const job = await this.getMigrationJob(jobId);
    const inventory = this.normalizeInventory(job.inventory, job.spaceId);

    await this.updateBackgroundWriterDrainStats(
      job,
      inventory,
      'background_writers_draining',
      this.buildBackgroundWriterDrainStats(
        { openCount: 0, sample: [] },
        { openCount: 0, sample: [] }
      )
    );

    try {
      for (;;) {
        await this.assertMigrationNotCanceled(jobId, job.spaceId);
        const stats = await this.inspectBackgroundWriterDrain(job.spaceId, inventory, {
          probeTimeoutMs,
          queueScanBatchSize,
          queueScanLimit,
          staleBefore: new Date(Date.now() - staleNonTerminalMs),
        });
        if (stats.openCount === 0) {
          await this.updateBackgroundWriterDrainStats(
            job,
            inventory,
            'background_writers_drained',
            stats
          );
          return stats;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          const lastError = `Timed out waiting for background writers to drain for migration job ${jobId}`;
          await this.migrationJobClient.spaceDataDbMigrationJob.update({
            where: { id: jobId },
            data: {
              state: 'failed',
              lastError,
              copyStats: {
                phase: 'background_writer_drain_timeout',
                progress: this.buildMigrationProgress(
                  job,
                  inventory,
                  'background_writer_drain_timeout'
                ),
                backgroundWriters: stats,
              },
            },
          });
          throw new CustomHttpException(lastError, HttpErrorCode.CONFLICT, {
            errorCode: spaceDataDbBackgroundWriterDrainTimeoutErrorCode,
            openCount: stats.openCount,
            provisionResourceCount: stats.provisionResourceCount,
            queueJobCount: stats.queueJobCount,
            spaceId: job.spaceId,
            migrationJobId: jobId,
          });
        }

        await this.updateBackgroundWriterDrainStats(
          job,
          inventory,
          'background_writers_draining',
          stats
        );
        await delay(pollMs);
      }
    } catch (error) {
      if (error instanceof CustomHttpException) {
        throw error;
      }
      const lastError = error instanceof Error ? error.message : String(error);
      await this.migrationJobClient.spaceDataDbMigrationJob.update({
        where: { id: jobId },
        data: {
          state: 'failed',
          lastError,
          copyStats: {
            phase: 'background_writer_drain_failed',
            progress: this.buildMigrationProgress(job, inventory, 'background_writer_drain_failed'),
            backgroundWriters: {
              failedAt: new Date().toISOString(),
            },
          },
        },
      });
      throw error;
    }
  }

  async assertSourceInventoryUnchangedForJob(jobId: string): Promise<void> {
    const job = await this.getMigrationJob(jobId);
    const expected = this.normalizeInventory(job.inventory, job.spaceId);
    const actual = await this.buildInventory(job.spaceId, job.targetInternalSchema, undefined, {
      copySpaceIds: expected.copySpaceIds,
    });
    const mismatches = this.compareInventoryForCopy(expected, actual, {
      compareSharedScope: true,
    });
    const checkedAt = new Date().toISOString();

    if (!mismatches.length) {
      await this.migrationJobClient.spaceDataDbMigrationJob.update({
        where: { id: jobId },
        data: {
          copyStats: {
            phase: 'source_inventory_verified',
            progress: this.buildMigrationProgress(job, actual, 'source_inventory_verified'),
            sourceInventory: {
              baseCount: actual.baseIds.length,
              tableCount: actual.tableIds.length,
              physicalRelationCount: this.buildPhysicalRelationKeys(actual).length,
              checkedAt,
            },
          },
          lastError: null,
        },
      });
      return;
    }

    const lastError = `Source inventory changed after migration job ${jobId} was created`;
    await this.migrationJobClient.spaceDataDbMigrationJob.update({
      where: { id: jobId },
      data: {
        state: 'failed',
        lastError,
        copyStats: {
          phase: 'source_inventory_changed',
          progress: this.buildMigrationProgress(job, expected, 'source_inventory_changed'),
          sourceInventory: {
            mismatches,
            checkedAt,
          },
        },
      },
    });
    throw new CustomHttpException(lastError, HttpErrorCode.CONFLICT, {
      errorCode: spaceDataDbInventoryChangedErrorCode,
      mismatches,
      spaceId: job.spaceId,
      migrationJobId: jobId,
    });
  }

  async assertTempWorkDirCapacityForJob(
    jobId: string,
    workDir: string,
    options: {
      multiplier?: number;
      minFreeBytes?: number;
      baseSchemaCopyStrategy?: ISpaceDataDbBaseSchemaCopyStrategy;
    } = {}
  ): Promise<void> {
    const job = await this.getMigrationJob(jobId);
    const inventory = this.normalizeInventory(job.inventory, job.spaceId);
    const multiplier = Math.max(1, options.multiplier ?? defaultTempDiskMultiplier);
    const minFreeBytes = Math.max(0, options.minFreeBytes ?? defaultTempDiskMinFreeBytes);
    const strategy = options.baseSchemaCopyStrategy ?? 'pg_dump_stream_restore';
    const requiresFullDumpSpace = strategy !== 'pg_dump_stream_restore';
    const estimatedDumpBytes = requiresFullDumpSpace
      ? Math.ceil(inventory.estimatedTotalBytes * multiplier)
      : 0;
    const requiredBytes = Math.max(estimatedDumpBytes, minFreeBytes);
    const checkedAt = new Date().toISOString();
    const stats = (await this.statfs(workDir)) as {
      bavail?: number | bigint;
      bfree: number | bigint;
      bsize: number | bigint;
    };
    const availableBlocks = stats.bavail ?? stats.bfree;
    const availableBytes = Number(availableBlocks) * Number(stats.bsize);
    const tempDisk = {
      workDir,
      strategy,
      estimatedTotalBytes: inventory.estimatedTotalBytes,
      multiplier,
      requiresFullDumpSpace,
      requiredBytes,
      availableBytes,
      checkedAt,
    };

    if (availableBytes >= requiredBytes) {
      await this.migrationJobClient.spaceDataDbMigrationJob.update({
        where: { id: jobId },
        data: {
          copyStats: {
            phase: 'temp_disk_checked',
            progress: this.buildMigrationProgress(job, inventory, 'temp_disk_checked'),
            tempDisk,
          },
          lastError: null,
        },
      });
      return;
    }

    const lastError = `Insufficient temp disk space for migration job ${jobId}`;
    await this.migrationJobClient.spaceDataDbMigrationJob.update({
      where: { id: jobId },
      data: {
        state: 'failed',
        lastError,
        copyStats: {
          phase: 'temp_disk_insufficient',
          progress: this.buildMigrationProgress(job, inventory, 'temp_disk_insufficient'),
          tempDisk,
        },
      },
    });
    throw new CustomHttpException(lastError, HttpErrorCode.CONFLICT, {
      errorCode: spaceDataDbTempDiskInsufficientErrorCode,
      requiredBytes,
      availableBytes,
      workDir,
      spaceId: job.spaceId,
      migrationJobId: jobId,
    });
  }

  async waitForSourceComputedDrainForJob(
    jobId: string,
    options: { timeoutMs?: number; pollMs?: number; processingLeaseMs?: number } = {}
  ): Promise<IComputedDrainStats> {
    const timeoutMs = Math.max(0, Math.floor(options.timeoutMs ?? defaultComputedDrainTimeoutMs));
    const pollMs = Math.max(1, Math.floor(options.pollMs ?? defaultComputedDrainPollMs));
    const processingLeaseMs = Math.max(
      1,
      Math.floor(options.processingLeaseMs ?? defaultComputedProcessingLeaseMs)
    );
    const startedAt = Date.now();
    const job = await this.getMigrationJob(jobId);
    const inventory = this.normalizeInventory(job.inventory, job.spaceId);

    if (!inventory.baseIds.length) {
      const drained = this.buildComputedDrainStats({
        activeCount: 0,
        reclaimableCount: 0,
        oldestActiveLockedAt: null,
      });
      await this.updateComputedDrainStats(job, inventory, 'computed_drained', drained);
      return drained;
    }

    const sourceDataDb = await this.getSourceDataDbForJob(job);
    const sourceSchema = sourceDataDb.internalSchema ?? 'public';
    const client = this.clientFactory(sourceDataDb.url);

    await this.updateComputedDrainStats(
      job,
      inventory,
      'computed_draining',
      this.buildComputedDrainStats({
        activeCount: 0,
        reclaimableCount: 0,
        oldestActiveLockedAt: null,
      })
    );

    try {
      try {
        for (;;) {
          await this.assertMigrationNotCanceled(jobId, job.spaceId);
          const stats = await this.inspectSourceComputedDrain(
            client,
            sourceSchema,
            inventory.baseIds,
            processingLeaseMs
          );

          if (stats.activeCount === 0) {
            await this.updateComputedDrainStats(job, inventory, 'computed_drained', stats);
            return stats;
          }

          if (Date.now() - startedAt >= timeoutMs) {
            const lastError = `Timed out waiting for source computed tasks to drain for migration job ${jobId}`;
            await this.migrationJobClient.spaceDataDbMigrationJob.update({
              where: { id: jobId },
              data: {
                state: 'failed',
                lastError,
                copyStats: {
                  phase: 'computed_drain_timeout',
                  progress: this.buildMigrationProgress(job, inventory, 'computed_drain_timeout'),
                  computedDrain: stats,
                },
              },
            });
            throw new CustomHttpException(lastError, HttpErrorCode.CONFLICT, {
              errorCode: spaceDataDbComputedDrainTimeoutErrorCode,
              activeCount: stats.activeCount,
              reclaimableCount: stats.reclaimableCount,
              spaceId: job.spaceId,
              migrationJobId: jobId,
            });
          }

          await this.updateComputedDrainStats(job, inventory, 'computed_draining', stats);
          await delay(pollMs);
        }
      } catch (error) {
        if (error instanceof CustomHttpException) {
          throw error;
        }
        const lastError = error instanceof Error ? error.message : String(error);
        await this.migrationJobClient.spaceDataDbMigrationJob.update({
          where: { id: jobId },
          data: {
            state: 'failed',
            lastError,
            copyStats: {
              phase: 'computed_drain_failed',
              progress: this.buildMigrationProgress(job, inventory, 'computed_drain_failed'),
              computedDrain: {
                failedAt: new Date().toISOString(),
              },
            },
          },
        });
        throw error;
      }
    } finally {
      await client.destroy().catch(() => undefined);
    }
  }

  async pauseSourceComputedForJob(jobId: string): Promise<{ created: boolean }> {
    const job = await this.getMigrationJob(jobId);
    const inventory = this.normalizeInventory(job.inventory, job.spaceId);
    const spaceIds = this.getInventoryCopySpaceIds(inventory);
    const sourceDataDb = await this.getSourceDataDbForJob(job);
    const sourceSchema = sourceDataDb.internalSchema ?? 'public';
    const client = this.clientFactory(sourceDataDb.url);

    try {
      const pause = await this.insertMigrationComputedPause(client, sourceSchema, spaceIds, job);

      await this.migrationJobClient.spaceDataDbMigrationJob.update({
        where: { id: jobId },
        data: {
          copyStats: {
            phase: 'computed_paused',
            progress: this.buildMigrationProgress(
              job,
              this.normalizeInventory(job.inventory, job.spaceId),
              'computed_paused'
            ),
            computedPause: {
              sourceSchema,
              created: pause.created,
              createdCount: pause.createdCount,
              spaceIds,
              reason: migrationPauseReason(job.id),
              pausedAt: new Date().toISOString(),
            },
          },
          lastError: null,
        },
      });

      return { created: pause.created };
    } finally {
      await client.destroy().catch(() => undefined);
    }
  }

  async pauseTargetComputedForJob(jobId: string): Promise<{ created: boolean }> {
    const job = await this.getMigrationJob(jobId);
    if (!job.targetConnection?.encryptedUrl) {
      throw new CustomHttpException(
        `Migration job ${jobId} has no target connection`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    const client = this.clientFactory(decryptDataDbUrl(job.targetConnection.encryptedUrl));

    try {
      const pause = await this.insertMigrationComputedPause(
        client,
        job.targetInternalSchema,
        this.getInventoryCopySpaceIds(this.normalizeInventory(job.inventory, job.spaceId)),
        job
      );
      return { created: pause.created };
    } finally {
      await client.destroy().catch(() => undefined);
    }
  }

  async resumeSourceComputedForJob(jobId: string): Promise<{ deleted: number }> {
    const job = await this.getMigrationJob(jobId);
    const inventory = this.normalizeInventory(job.inventory, job.spaceId);
    const sourceDataDb = await this.getSourceDataDbForJob(job);
    const sourceSchema = sourceDataDb.internalSchema ?? 'public';
    const client = this.clientFactory(sourceDataDb.url);

    try {
      return await this.deleteMigrationComputedPause(
        client,
        sourceSchema,
        this.getInventoryCopySpaceIds(inventory),
        job.id
      );
    } finally {
      await client.destroy().catch(() => undefined);
    }
  }

  async resumeTargetComputedForJob(jobId: string): Promise<{ deleted: number }> {
    const job = await this.getMigrationJob(jobId);
    if (!job.targetConnection?.encryptedUrl) {
      throw new CustomHttpException(
        `Migration job ${jobId} has no target connection`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    const client = this.clientFactory(decryptDataDbUrl(job.targetConnection.encryptedUrl));

    try {
      return await this.deleteMigrationComputedPause(
        client,
        job.targetInternalSchema,
        this.getInventoryCopySpaceIds(this.normalizeInventory(job.inventory, job.spaceId)),
        job.id
      );
    } finally {
      await client.destroy().catch(() => undefined);
    }
  }

  private async insertMigrationComputedPause(
    client: IDataDbPreflightClient,
    schema: string,
    spaceIds: string[],
    job: IMigrationJobRecord
  ) {
    if (!spaceIds.length) {
      return { created: false, createdCount: 0 };
    }

    const valuesSql = spaceIds.map(() => `(?, 'space', ?, now(), ?, NULL, ?, now(), ?)`).join(', ');
    const bindings = spaceIds.flatMap((spaceId) => [
      `sdmp_${job.id}_${spaceId}`,
      spaceId,
      job.createdBy,
      migrationPauseReason(job.id),
      job.createdBy,
    ]);
    const pauseTable = qualify(schema, sharedTables.computedUpdatePauseScope);
    const pauseReason = migrationPauseReason(job.id);
    const rows = normalizeRawRows<{ id: string }>(
      await client.raw(
        `
          INSERT INTO ${pauseTable} AS "pause_scope"
            ("id", "scope_type", "scope_id", "paused_at", "paused_by", "resume_at", "reason", "updated_at", "updated_by")
          VALUES ${valuesSql}
          ON CONFLICT ("scope_type", "scope_id") DO UPDATE
          SET "id" = EXCLUDED."id",
              "paused_at" = EXCLUDED."paused_at",
              "paused_by" = EXCLUDED."paused_by",
              "resume_at" = EXCLUDED."resume_at",
              "reason" = EXCLUDED."reason",
              "updated_at" = EXCLUDED."updated_at",
              "updated_by" = EXCLUDED."updated_by"
          WHERE "pause_scope"."reason" = ?
             OR (
               "pause_scope"."resume_at" IS NOT NULL
               AND "pause_scope"."resume_at" <= now()
             )
          RETURNING "id"
        `,
        [...bindings, pauseReason]
      )
    );
    return { created: rows.length > 0, createdCount: rows.length };
  }

  async getMigrationJobStatus(
    spaceId: string,
    jobId: string
  ): Promise<IDataDbMigrationJobStatusVo> {
    const job = (await this.migrationJobClient.spaceDataDbMigrationJob.findFirst({
      where: { id: jobId },
      include: { targetConnection: true },
    })) as IMigrationJobStatusRecord | null;
    if (!job || !this.jobStatusIncludesSpace(job, spaceId)) {
      throw new CustomHttpException(
        `Migration job ${jobId} was not found for space ${spaceId}`,
        HttpErrorCode.NOT_FOUND
      );
    }
    const inventory = this.normalizeInventory(job.inventory, job.spaceId);

    return {
      jobId: job.id,
      spaceId: job.spaceId,
      targetMode: 'migrate-space',
      switchOnCompletion: job.switchOnCompletion === true,
      state: job.state as IDataDbMigrationJobStatusVo['state'],
      targetInternalSchema: job.targetInternalSchema,
      targetConnection: job.targetConnection
        ? {
            provider: job.targetConnection.provider,
            displayHost: job.targetConnection.displayHost ?? undefined,
            displayDatabase: job.targetConnection.displayDatabase ?? undefined,
            internalSchema: job.targetConnection.internalSchema,
            schemaVersion: job.targetConnection.schemaVersion,
            lastValidatedAt: job.targetConnection.lastValidatedAt?.toISOString(),
            lastError: job.targetConnection.lastError ?? undefined,
            capabilities: job.targetConnection.capabilities as IDataDbPreflightVo['capabilities'],
          }
        : null,
      relatedSpaces: inventory.relatedSpaces,
      inventory: job.inventory,
      copyStats: job.copyStats,
      validationStats: job.validationStats,
      lastError: job.lastError,
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      createdTime: job.createdTime.toISOString(),
      lastModifiedTime: job.lastModifiedTime?.toISOString() ?? null,
    };
  }

  private jobStatusIncludesSpace(job: IMigrationJobStatusRecord, spaceId: string) {
    if (job.spaceId === spaceId) {
      return true;
    }
    const inventory = this.normalizeInventory(job.inventory, job.spaceId);
    return this.getInventorySpaceIds(inventory).includes(spaceId);
  }

  async cancelMigrationForSpace(
    spaceId: string,
    jobId: string,
    canceledBy: string
  ): Promise<IDataDbMigrationJobStatusVo> {
    const job = await this.getMigrationJob(jobId);
    if (
      !this.getInventorySpaceIds(this.normalizeInventory(job.inventory, job.spaceId)).includes(
        spaceId
      )
    ) {
      throw new CustomHttpException(
        `Migration job ${jobId} was not found for space ${spaceId}`,
        HttpErrorCode.NOT_FOUND
      );
    }

    if (job.state === 'canceled') {
      return await this.getMigrationJobStatus(spaceId, jobId);
    }

    if (!cancelableSpaceDataDbMigrationStates.includes(job.state as never)) {
      throw new CustomHttpException(
        'Only pre-validation space data database migrations can be canceled safely',
        HttpErrorCode.CONFLICT,
        {
          errorCode: spaceDataDbMigrationCancelConflictErrorCode,
          migrationJobId: jobId,
          migrationState: job.state,
          spaceId,
        }
      );
    }

    await this.resumeSourceComputedForJob(jobId);

    const lastError = `Space data database migration canceled by ${canceledBy || 'unknown user'}`;
    const runTransaction = this.prismaService.$tx.bind(this.prismaService) as unknown as <T>(
      fn: (prisma: IPrismaTransactionClient) => Promise<T>
    ) => Promise<T>;
    await runTransaction(async (prisma) => {
      if (job.targetConnectionId) {
        await prisma.dataDbConnection.update({
          where: { id: job.targetConnectionId },
          data: {
            status: 'error',
            lastError,
          },
        });
      }
      await prisma.spaceDataDbMigrationJob.update({
        where: { id: jobId },
        data: {
          state: 'canceled',
          completedAt: new Date(),
          lastError,
          copyStats: {
            phase: 'canceled_before_copy',
            progress: this.buildMigrationProgress(
              job,
              this.normalizeInventory(job.inventory, job.spaceId),
              'canceled_before_copy'
            ),
            canceled: {
              canceledBy,
              canceledAt: new Date().toISOString(),
            },
          },
        },
      });
    });

    return await this.getMigrationJobStatus(spaceId, jobId);
  }

  async rollbackMigrationForSpace(
    spaceId: string,
    jobId: string,
    rolledBackBy: string
  ): Promise<IDataDbMigrationJobStatusVo> {
    const job = await this.getMigrationJob(jobId);
    if (
      !this.getInventorySpaceIds(this.normalizeInventory(job.inventory, job.spaceId)).includes(
        spaceId
      )
    ) {
      throw new CustomHttpException(
        `Migration job ${jobId} was not found for space ${spaceId}`,
        HttpErrorCode.NOT_FOUND
      );
    }
    if (job.state === 'rolled_back') {
      return await this.getMigrationJobStatus(spaceId, jobId);
    }
    if (job.state !== 'succeeded') {
      throw new CustomHttpException(
        'Only completed space data database migrations can be rolled back',
        HttpErrorCode.CONFLICT,
        {
          errorCode: spaceDataDbMigrationCancelConflictErrorCode,
          migrationJobId: jobId,
          migrationState: job.state,
          spaceId,
        }
      );
    }
    if (job.switchOnCompletion !== true) {
      throw new CustomHttpException(
        'Only migrations that switched the space data database can be rolled back',
        HttpErrorCode.CONFLICT,
        {
          errorCode: spaceDataDbRollbackUnsafeErrorCode,
          migrationJobId: jobId,
          migrationState: job.state,
          spaceId,
        }
      );
    }
    if (!job.completedAt) {
      throw new CustomHttpException(
        `Migration job ${jobId} has no switch timestamp`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    this.assertRollbackSourceSupported(job);
    await this.migrationJobClient.spaceDataDbMigrationJob.update({
      where: { id: jobId },
      data: { state: 'switching', lastError: null },
    });

    let restoredBeforeThrow = false;
    let rollbackCompleted = false;
    try {
      const rollbackProof = await this.inspectPostSwitchRollbackProof(job);
      if (!rollbackProof.eligible) {
        const lastError = 'Space data database migration rollback is unsafe after target writes';
        await this.migrationJobClient.spaceDataDbMigrationJob.update({
          where: { id: jobId },
          data: {
            state: 'succeeded',
            lastError,
            validationStats: this.mergeValidationStats(job.validationStats, {
              rollback: rollbackProof,
            }),
          },
        });
        restoredBeforeThrow = true;
        throw new CustomHttpException(lastError, HttpErrorCode.CONFLICT, {
          errorCode: spaceDataDbRollbackUnsafeErrorCode,
          migrationJobId: jobId,
          spaceId,
          rollback: rollbackProof,
        });
      }
      const sourceDataDb = this.getSourceDataDbFromInventory(job);
      const spaceIds = this.getInventoryCopySpaceIds(
        this.normalizeInventory(job.inventory, job.spaceId)
      );

      const runTransaction = this.prismaService.$tx.bind(this.prismaService) as unknown as <T>(
        fn: (prisma: IPrismaTransactionClient) => Promise<T>
      ) => Promise<T>;
      await runTransaction(async (prisma) => {
        for (const relatedSpaceId of spaceIds) {
          await prisma.spaceDataDbBinding.upsert({
            where: { spaceId: relatedSpaceId },
            create: {
              spaceId: relatedSpaceId,
              dataDbConnectionId: job.sourceConnectionId,
              mode: job.sourceConnectionId ? 'byodb' : 'default',
              state: 'ready',
              createdBy: rolledBackBy || job.createdBy,
            },
            update: {
              dataDbConnectionId: job.sourceConnectionId,
              mode: job.sourceConnectionId ? 'byodb' : 'default',
              state: 'ready',
            },
          });
        }
        await prisma.spaceDataDbMigrationJob.update({
          where: { id: jobId },
          data: {
            state: 'rolled_back',
            completedAt: new Date(),
            lastError: null,
            validationStats: this.mergeValidationStats(job.validationStats, {
              rollback: {
                ...rollbackProof,
                rolledBackBy,
                rolledBackAt: new Date().toISOString(),
              },
            }),
          },
        });
      });

      if (job.targetConnectionId) {
        await this.dataDbClientManager.invalidateConnection(job.targetConnectionId);
      }
      if (job.sourceConnectionId) {
        await this.dataDbClientManager.invalidateConnection(job.sourceConnectionId);
      }
      await this.resumeOriginalSourceComputedPause(job, sourceDataDb);
      rollbackCompleted = true;
      return await this.getMigrationJobStatus(spaceId, jobId);
    } catch (error) {
      if (!rollbackCompleted && !restoredBeforeThrow) {
        await this.migrationJobClient.spaceDataDbMigrationJob.update({
          where: { id: jobId },
          data: {
            state: 'succeeded',
            lastError: error instanceof Error ? error.message : String(error),
          },
        });
      }
      throw error;
    }
  }

  private assertRollbackSourceSupported(job: IMigrationJobRecord) {
    const inventory = this.normalizeInventory(job.inventory, job.spaceId);
    if (inventory.sourceDataDb.mode === 'default' && !inventory.sourceDataDb.connectionId) {
      return;
    }

    throw new CustomHttpException(
      'Rolling back migrations from a BYODB source is not supported yet',
      HttpErrorCode.VALIDATION_ERROR
    );
  }

  private getSourceDataDbFromInventory(job: IMigrationJobRecord): IResolvedDataDatabase {
    const inventory = this.normalizeInventory(job.inventory, job.spaceId);
    if (inventory.sourceDataDb.mode === 'default' && !inventory.sourceDataDb.connectionId) {
      return {
        cacheKey: metaFallbackDataDbCacheKey,
        url: getMetaDatabaseUrl(),
        isMetaFallback: true,
      };
    }

    this.assertRollbackSourceSupported(job);
    throw new Error('Unsupported rollback source data database');
  }

  private async getSourceDataDbForJob(job: IMigrationJobRecord): Promise<IResolvedDataDatabase> {
    const inventory = this.normalizeInventory(job.inventory, job.spaceId);
    return await this.dataDbClientManager.getDataDatabaseForSpace(job.spaceId, {
      sourceConnectionId: inventory.sourceDataDb.connectionId,
    });
  }

  private async resumeOriginalSourceComputedPause(
    job: IMigrationJobRecord,
    sourceDataDb: IResolvedDataDatabase
  ): Promise<{ deleted: number }> {
    const client = this.clientFactory(sourceDataDb.url);
    try {
      return await this.deleteMigrationComputedPause(
        client,
        sourceDataDb.internalSchema ?? 'public',
        this.getInventoryCopySpaceIds(this.normalizeInventory(job.inventory, job.spaceId)),
        job.id
      );
    } finally {
      await client.destroy().catch(() => undefined);
    }
  }

  private async inspectPostSwitchRollbackProof(
    job: IMigrationJobRecord
  ): Promise<IPostSwitchRollbackProof> {
    const switchedAt = job.completedAt?.toISOString();
    const proof: IPostSwitchRollbackProof = {
      eligible: false,
      switchedAt: switchedAt ?? '',
      checkedAt: new Date().toISOString(),
      findings: [],
    };

    if (!switchedAt) {
      proof.findings.push({
        object: `migration:${job.id}`,
        reason: 'missing_switch_timestamp',
      });
      return proof;
    }
    if (!job.targetConnection?.encryptedUrl) {
      proof.findings.push({
        object: `migration:${job.id}`,
        reason: 'missing_target_connection',
      });
      return proof;
    }

    const inventory = this.normalizeInventory(job.inventory, job.spaceId);
    const targetClient = this.clientFactory(decryptDataDbUrl(job.targetConnection.encryptedUrl));

    try {
      await this.collectRollbackRelationFindings(targetClient, inventory, proof.findings);
      await this.collectRollbackRowCountFindings(
        targetClient,
        job.targetInternalSchema,
        inventory,
        job.spaceId,
        job.validationStats,
        proof.findings
      );
      await this.collectRollbackTimestampFindings(
        targetClient,
        job.targetInternalSchema,
        inventory,
        job.spaceId,
        switchedAt,
        proof.findings
      );
    } catch (error) {
      proof.findings.push({
        object: `migration:${job.id}`,
        reason: `proof_query_failed:${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      await targetClient.destroy().catch(() => undefined);
    }

    return {
      ...proof,
      eligible: proof.findings.length === 0,
    };
  }

  private async collectRollbackRelationFindings(
    targetClient: IDataDbPreflightClient,
    inventory: ISpaceDataDbInventory,
    findings: IPostSwitchWriteFinding[]
  ) {
    const expectedKeys = this.buildPhysicalRelationKeys(inventory);
    const actualKeys = this.buildPhysicalRelationKeysFromRelations(
      await this.inspectPhysicalSchemasWithClient(targetClient, inventory.baseIds)
    );

    if (JSON.stringify(expectedKeys) === JSON.stringify(actualKeys)) {
      return;
    }

    findings.push({
      object: 'base:physicalRelations',
      reason: 'relation_inventory_changed',
      expectedCount: expectedKeys.length,
      actualCount: actualKeys.length,
    });
  }

  private async collectRollbackRowCountFindings(
    targetClient: IDataDbPreflightClient,
    targetSchema: string,
    inventory: ISpaceDataDbInventory,
    spaceId: string,
    validationStats: unknown,
    findings: IPostSwitchWriteFinding[]
  ) {
    const baseRows = this.getValidationRows(validationStats, 'baseSchemas');
    const sharedRows = this.getValidationRows(validationStats, 'sharedTables');

    if (!baseRows || !sharedRows) {
      findings.push({
        object: `migration:${spaceId}`,
        reason: 'missing_validation_stats',
      });
      return;
    }

    for (const row of baseRows) {
      const relation = this.parseBaseValidationObject(row.object);
      if (!relation) {
        findings.push({ object: row.object, reason: 'invalid_base_validation_object' });
        continue;
      }

      const actualCount = await this.countRows(
        targetClient,
        relation.schemaName,
        relation.relationName
      );
      if (actualCount !== row.targetCount) {
        findings.push({
          object: row.object,
          reason: 'row_count_changed',
          expectedCount: row.targetCount,
          actualCount,
        });
      }
    }

    const sharedRowsByTable = new Map(
      sharedRows.map((row) => [row.object.replace(/^shared:/, ''), row])
    );
    for (const plan of this.buildSharedTableCountPlans(inventory, spaceId)) {
      const row = sharedRowsByTable.get(plan.table);
      if (!row) {
        findings.push({
          object: `shared:${plan.table}`,
          reason: 'missing_shared_validation_row',
        });
        continue;
      }

      const actualCount = await this.countRows(
        targetClient,
        targetSchema,
        plan.table,
        plan.whereSql(targetSchema),
        plan.bindings
      );
      if (actualCount !== row.targetCount) {
        findings.push({
          object: row.object,
          reason: 'row_count_changed',
          expectedCount: row.targetCount,
          actualCount,
        });
      }
    }
  }

  private async collectRollbackTimestampFindings(
    targetClient: IDataDbPreflightClient,
    targetSchema: string,
    inventory: ISpaceDataDbInventory,
    spaceId: string,
    switchedAt: string,
    findings: IPostSwitchWriteFinding[]
  ) {
    await this.collectRollbackBaseTimestampFindings(targetClient, inventory, switchedAt, findings);
    await this.collectRollbackSharedTimestampFindings(
      targetClient,
      targetSchema,
      inventory,
      spaceId,
      switchedAt,
      findings
    );
  }

  private async collectRollbackBaseTimestampFindings(
    targetClient: IDataDbPreflightClient,
    inventory: ISpaceDataDbInventory,
    switchedAt: string,
    findings: IPostSwitchWriteFinding[]
  ) {
    for (const schema of inventory.physicalSchemas) {
      for (const relation of schema.relations) {
        if (!relationKindsWithRows.has(relation.relationKind)) {
          continue;
        }

        const columns = await this.getExistingColumns(
          targetClient,
          relation.schemaName,
          relation.relationName,
          ['__created_time', '__last_modified_time']
        );
        if (!columns.length) {
          continue;
        }

        const count = await this.countRows(
          targetClient,
          relation.schemaName,
          relation.relationName,
          columns.map((column) => `${quoteIdent(column)} > ?::timestamp`).join(' OR '),
          columns.map(() => switchedAt)
        );
        if (count > 0) {
          findings.push({
            object: `base:${relation.schemaName}.${relation.relationName}`,
            reason: 'post_switch_timestamp_rows',
            count,
          });
        }
      }
    }
  }

  private async collectRollbackSharedTimestampFindings(
    targetClient: IDataDbPreflightClient,
    targetSchema: string,
    inventory: ISpaceDataDbInventory,
    spaceId: string,
    switchedAt: string,
    findings: IPostSwitchWriteFinding[]
  ) {
    const plans = this.buildPostSwitchSharedWritePlans(inventory, spaceId, switchedAt);

    for (const plan of plans) {
      const count = await this.countRows(
        targetClient,
        targetSchema,
        plan.table,
        plan.whereSql,
        plan.bindings
      );
      if (count > 0) {
        findings.push({
          object: `shared:${plan.table}`,
          reason: 'post_switch_timestamp_rows',
          count,
        });
      }
    }
  }

  private buildPostSwitchSharedWritePlans(
    inventory: ISpaceDataDbInventory,
    spaceId: string,
    switchedAt: string
  ) {
    const plans: { table: string; whereSql: string; bindings: unknown[] }[] = [];
    const spaceIds = this.getInventoryCopySpaceIds(inventory);
    const pushTableScoped = (table: string) => {
      if (!inventory.tableIds.length) {
        return;
      }
      plans.push({
        table,
        whereSql: `"created_time" > ?::timestamp AND "table_id" = ANY(?::text[])`,
        bindings: [switchedAt, inventory.tableIds],
      });
    };
    const pushBaseScoped = (table: string) => {
      if (!inventory.baseIds.length) {
        return;
      }
      plans.push({
        table,
        whereSql: [
          `("created_at" > ?::timestamp OR "updated_at" > ?::timestamp)`,
          `AND "base_id" = ANY(?::text[])`,
        ].join(' '),
        bindings: [switchedAt, switchedAt, inventory.baseIds],
      });
    };

    pushTableScoped(sharedTables.recordHistory);
    pushTableScoped(sharedTables.tableTrash);
    pushTableScoped(sharedTables.recordTrash);
    pushBaseScoped(sharedTables.computedUpdateOutbox);
    pushBaseScoped(sharedTables.computedUpdateDeadLetter);

    plans.push({
      table: sharedTables.computedUpdatePauseScope,
      whereSql: [
        `("paused_at" > ?::timestamp OR "updated_at" > ?::timestamp)`,
        `(`,
        `("scope_type" = 'space' AND "scope_id" = ANY(?::text[]))`,
        inventory.baseIds.length
          ? `OR ("scope_type" = 'base' AND "scope_id" = ANY(?::text[]))`
          : '',
        inventory.tableIds.length
          ? `OR ("scope_type" = 'table' AND "scope_id" = ANY(?::text[]))`
          : '',
        `)`,
      ]
        .filter(Boolean)
        .join(' '),
      bindings: [switchedAt, switchedAt, spaceIds, inventory.baseIds, inventory.tableIds].filter(
        (value) => (Array.isArray(value) ? value.length > 0 : Boolean(value))
      ),
    });

    if (inventory.baseIds.length) {
      plans.push({
        table: sharedTables.undoLog,
        whereSql: [
          `"created_at" > ?::timestamp`,
          `AND split_part("table_name", '.', 1) = ANY(?::text[])`,
        ].join(' '),
        bindings: [switchedAt, inventory.baseIds],
      });
    }

    return plans;
  }

  private getValidationRows(
    validationStats: unknown,
    key: 'baseSchemas' | 'sharedTables'
  ): IRowCountValidation[] | null {
    const stats = this.asRecord(validationStats);
    const rows = stats?.[key];
    if (!Array.isArray(rows)) {
      return null;
    }

    return rows
      .map((row) => this.asRecord(row))
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .map((row) => ({
        object: typeof row.object === 'string' ? row.object : '',
        sourceCount: Number(row.sourceCount ?? 0),
        targetCount: Number(row.targetCount ?? 0),
      }))
      .filter((row) => row.object);
  }

  private parseBaseValidationObject(object: string) {
    if (!object.startsWith('base:')) {
      return null;
    }

    const qualified = object.slice('base:'.length);
    const separatorIndex = qualified.indexOf('.');
    if (separatorIndex <= 0 || separatorIndex === qualified.length - 1) {
      return null;
    }

    return {
      schemaName: qualified.slice(0, separatorIndex),
      relationName: qualified.slice(separatorIndex + 1),
    };
  }

  private async getExistingColumns(
    client: IDataDbPreflightClient,
    schema: string,
    table: string,
    columns: string[]
  ) {
    const rows = normalizeRawRows<{ columnName: string }>(
      await client.raw(
        `
          SELECT column_name AS "columnName"
          FROM information_schema.columns
          WHERE table_schema = ?
            AND table_name = ?
            AND column_name = ANY(?::text[])
        `,
        [schema, table, columns]
      )
    );
    return rows.map((row) => row.columnName).filter((column) => columns.includes(column));
  }

  private buildPhysicalRelationKeysFromRelations(relations: ISpaceDataDbPhysicalRelation[]) {
    return relations
      .map((relation) => `${relation.schemaName}.${relation.relationName}:${relation.relationKind}`)
      .sort();
  }

  private mergeValidationStats(validationStats: unknown, next: Record<string, unknown>) {
    return {
      ...(this.asRecord(validationStats) ?? {}),
      ...next,
    };
  }

  async copySharedRowsForJob(
    jobId: string,
    options: {
      timeoutMs?: number;
      strategy?: ISpaceDataDbSharedTableCopyStrategy;
      snapshotId?: string;
    }
  ) {
    const job = await this.migrationJobClient.spaceDataDbMigrationJob.findUnique({
      where: { id: jobId },
      include: { targetConnection: true },
    });
    if (!job) {
      throw new CustomHttpException(`Migration job ${jobId} not found`, HttpErrorCode.NOT_FOUND);
    }
    if (!job.targetConnection?.encryptedUrl) {
      throw new CustomHttpException(
        `Migration job ${jobId} has no target connection`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }

    const inventory = this.normalizeInventory(job.inventory, job.spaceId);
    const sourceDataDb = await this.getSourceDataDbForJob(job);
    const targetUrl = decryptDataDbUrl(job.targetConnection.encryptedUrl);
    const startedAt = new Date().toISOString();
    const strategy = options.strategy ?? 'psql_copy';
    if (options.snapshotId && strategy !== 'psql_copy') {
      throw new Error(
        'Snapshot-aware shared table copy is only supported by the psql_copy strategy'
      );
    }
    const sourceSchema = sourceDataDb.internalSchema ?? 'public';
    const sharedPlanInput = {
      sourceUrl: sourceDataDb.url,
      targetUrl,
      sourceSchema,
      targetSchema: job.targetInternalSchema,
      spaceId: job.spaceId,
      spaceIds: this.getInventoryCopySpaceIds(inventory),
      baseIds: inventory.baseIds,
      tableIds: inventory.tableIds,
      sharedTableIds: inventory.sharedTableIds,
      snapshotId: options.snapshotId,
    };
    const fdwNamePrefix = this.buildPostgresFdwNamePrefix(jobId);
    const plans =
      strategy === 'postgres_fdw'
        ? buildMigrationSharedTablePostgresFdwCopyPlans({
            ...sharedPlanInput,
            fdwSchemaPrefix: `${fdwNamePrefix}_schema`,
            serverNamePrefix: `${fdwNamePrefix}_server`,
          })
        : buildMigrationSharedTablePsqlCopyPlans(sharedPlanInput);
    const tableNames = plans.map((plan) => plan.table);

    await this.migrationJobClient.spaceDataDbMigrationJob.update({
      where: { id: jobId },
      data: {
        state: 'copying',
        copyStats: {
          phase: 'copying_shared_rows',
          progress: this.buildMigrationProgress(job, inventory, 'copying_shared_rows'),
          sharedTables: {
            tableNames,
            totalTables: plans.length,
            copiedTableCount: 0,
            totalCopiedRows: 0,
            strategy,
            startedAt,
          },
        },
        lastError: null,
      },
    });

    const copiedTables: ISharedTableCopySummary[] = [];
    let targetComputedPaused = false;
    try {
      const onTableCopied = async (
        result: ISpaceDataDbSharedTableCopyResult | ISpaceDataDbPostgresFdwSharedTableCopyResult
      ) => {
        copiedTables.push(this.buildSharedTableCopySummary(result));
        if (
          job.switchOnCompletion === true &&
          result.table === sharedTables.computedUpdatePauseScope &&
          !targetComputedPaused
        ) {
          await this.pauseTargetComputedForJob(jobId);
          targetComputedPaused = true;
        }
        await this.migrationJobClient.spaceDataDbMigrationJob.update({
          where: { id: jobId },
          data: {
            state: 'copying',
            copyStats: {
              phase: 'copying_shared_rows',
              progress: this.buildMigrationProgress(job, inventory, 'copying_shared_rows', {
                stageFraction: this.sharedTableStageFraction(copiedTables.length, plans.length),
              }),
              sharedTables: {
                tableNames,
                totalTables: plans.length,
                copiedTableCount: copiedTables.length,
                totalCopiedRows: this.sumCopiedRows(copiedTables),
                copiedTables,
                strategy,
                startedAt,
                updatedAt: new Date().toISOString(),
              },
            },
            lastError: null,
          },
        });
      };
      const processOptions = this.buildCancelableProcessOptions(jobId, options.timeoutMs);
      const processOptionsWithHeartbeat = {
        ...processOptions,
        onPoll: async () => {
          await processOptions.onPoll?.();
          await this.updateSharedTableCopyHeartbeat(job, inventory, {
            stage: 'copying_shared_rows',
            tableNames,
            totalTables: plans.length,
            copiedTableCount: copiedTables.length,
            totalCopiedRows: this.sumCopiedRows(copiedTables),
            strategy,
            updatedAt: new Date().toISOString(),
          });
        },
      };
      const results =
        strategy === 'postgres_fdw'
          ? await this.copyService.copySharedTablesViaPostgresFdw(
              plans as ReturnType<typeof buildMigrationSharedTablePostgresFdwCopyPlans>,
              processOptionsWithHeartbeat,
              { onTableCopied }
            )
          : await this.copyService.copySharedTables(
              plans as ReturnType<typeof buildMigrationSharedTablePsqlCopyPlans>,
              processOptionsWithHeartbeat,
              { onTableCopied }
            );
      const copiedSharedTables = results.map((result) => this.buildSharedTableCopySummary(result));
      const copyStats = {
        phase: 'shared_rows_completed',
        progress: this.buildMigrationProgress(job, inventory, 'shared_rows_completed'),
        sharedTables: {
          tableNames,
          totalTables: plans.length,
          copiedTableCount: copiedSharedTables.length,
          totalCopiedRows: this.sumCopiedRows(copiedSharedTables),
          copiedTables: copiedSharedTables,
          strategy,
          startedAt,
          completedAt: new Date().toISOString(),
        },
      };
      await this.migrationJobClient.spaceDataDbMigrationJob.update({
        where: { id: jobId },
        data: {
          state: 'copying',
          copyStats,
          lastError: null,
        },
      });
      return copyStats;
    } catch (error) {
      if (await this.isProcessCancelErrorForJob(error, jobId)) {
        throw error;
      }
      const lastError = error instanceof Error ? error.message : String(error);
      await this.migrationJobClient.spaceDataDbMigrationJob.update({
        where: { id: jobId },
        data: {
          state: 'failed',
          lastError,
          copyStats: {
            phase: 'shared_rows_failed',
            progress: this.buildMigrationProgress(job, inventory, 'shared_rows_failed'),
            sharedTables: {
              tableNames,
              totalTables: plans.length,
              copiedTableCount: copiedTables.length,
              totalCopiedRows: this.sumCopiedRows(copiedTables),
              copiedTables,
              strategy,
              startedAt,
              failedAt: new Date().toISOString(),
              error: lastError,
              failure: this.buildProcessFailureStats(error),
            },
          },
        },
      });
      throw error;
    }
  }

  private buildSharedTableCopySummary(
    result: ISpaceDataDbSharedTableCopyResult | ISpaceDataDbPostgresFdwSharedTableCopyResult
  ): ISharedTableCopySummary {
    return {
      strategy: result.strategy,
      table: result.table,
      copiedRows: result.copiedRows,
      ...('source' in result ? { source: result.source } : {}),
      target: result.target,
    };
  }

  private async updateSharedTableCopyHeartbeat(
    job: IMigrationJobRecord,
    inventory: ISpaceDataDbInventory,
    heartbeat: ISharedTableCopyHeartbeat
  ) {
    await this.migrationJobClient.spaceDataDbMigrationJob
      .update({
        where: { id: job.id },
        data: {
          state: 'copying',
          copyStats: {
            phase: 'copying_shared_rows',
            progress: this.buildMigrationProgress(job, inventory, 'copying_shared_rows', {
              stageFraction: this.sharedTableStageFraction(
                heartbeat.copiedTableCount,
                heartbeat.totalTables
              ),
            }),
            sharedTables: heartbeat,
          },
          lastError: null,
        },
      })
      .catch(() => undefined);
  }

  private sharedTableStageFraction(copiedTableCount: number, totalTables: number) {
    if (totalTables <= 0) {
      return 0.99;
    }
    return Math.min(copiedTableCount / totalTables, 0.99);
  }

  private buildPostgresFdwNamePrefix(jobId: string) {
    const sanitized = jobId.replace(/\W/g, '_').slice(0, 24);
    return `teable_${sanitized}_fdw`;
  }

  private sumCopiedRows(results: { copiedRows: number | null }[]) {
    if (results.some((result) => result.copiedRows == null)) {
      return null;
    }
    return results.reduce((sum, result) => sum + (result.copiedRows ?? 0), 0);
  }

  private buildProcessFailureStats(error: unknown): ISpaceDataDbProcessFailureStats {
    if (error instanceof SpaceDataDbProcessPipelineError) {
      return {
        type: 'pipeline',
        message: error.message,
        result: error.result,
      };
    }
    if (error instanceof SpaceDataDbProcessError) {
      return {
        type: 'process',
        message: error.message,
        result: error.result,
      };
    }
    return {
      type: 'unknown',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  private buildProcessFailureMessage(error: unknown) {
    const readOnlyMessage = this.buildReadOnlyTargetFailureMessage(error);
    if (readOnlyMessage) {
      return readOnlyMessage;
    }
    const baseMessage = error instanceof Error ? error.message : String(error);
    const failureStats = this.buildProcessFailureStats(error);
    const detail = this.getProcessFailureDetail(failureStats);
    return detail ? `${baseMessage}: ${detail}` : baseMessage;
  }

  private buildReadOnlyTargetFailureMessage(error: unknown) {
    const failureStats = this.buildProcessFailureStats(error);
    const detail = this.getProcessFailureDetail(failureStats);
    const message = [error instanceof Error ? error.message : String(error), detail]
      .filter(Boolean)
      .join('\n');
    if (!/read-only transaction/i.test(message)) {
      return null;
    }
    return [
      'Target PostgreSQL connection is read-only and cannot be used for BYODB migration.',
      'Use a writable primary database connection. For Supabase, prefer the direct database endpoint or a writable session pooler instead of a read-only replica endpoint.',
    ].join(' ');
  }

  private getProcessFailureDetail(failureStats: ISpaceDataDbProcessFailureStats) {
    if (failureStats.type === 'process') {
      return this.formatProcessFailureResult(failureStats.result);
    }

    if (failureStats.type === 'pipeline') {
      const source = this.formatProcessFailureResult(failureStats.result.source);
      const target = this.formatProcessFailureResult(failureStats.result.target);
      return [source ? `source ${source}` : '', target ? `target ${target}` : '']
        .filter(Boolean)
        .join('; ');
    }

    return '';
  }

  private formatProcessFailureResult(result: ISpaceDataDbProcessFailureResult) {
    const exitOrSignal =
      result.exitCode != null
        ? `exit ${result.exitCode}`
        : result.signal
          ? `signal ${result.signal}`
          : '';
    const output = (result.stderr || result.stdout || '').trim();
    const outputTail = output.length > 800 ? output.slice(output.length - 800) : output;
    return [result.command, exitOrSignal, outputTail].filter(Boolean).join(' - ');
  }

  async validateAndSwitchJob(jobId: string) {
    const job = await this.getMigrationJob(jobId);
    const validationStats = await this.validateCopyForJob(jobId, {
      keepWriteGate: job.switchOnCompletion === true,
    });
    const inventory = this.normalizeInventory(job.inventory, job.spaceId);
    const spaceIds = this.getInventorySpaceIds(inventory);
    if (!job.targetConnectionId) {
      throw new CustomHttpException(
        `Migration job ${jobId} has no target connection`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }

    const switchOnCompletion = job.switchOnCompletion === true;
    let completedValidationStats: IValidationStats = {
      ...validationStats,
      switchOnCompletion,
      switched: false,
    };
    let switchedAt: Date | null = null;
    try {
      const runTransaction = this.prismaService.$tx.bind(this.prismaService) as unknown as <T>(
        fn: (prisma: IPrismaTransactionClient) => Promise<T>
      ) => Promise<T>;

      if (!switchOnCompletion) {
        await this.resumeTargetComputedForJob(jobId);
        await this.resumeSourceComputedForJob(jobId);
        await runTransaction(async (prisma) => {
          await prisma.dataDbConnection.update({
            where: { id: job.targetConnectionId },
            data: {
              status: 'ready',
              lastValidatedAt: new Date(),
              lastError: null,
            },
          });
          await prisma.spaceDataDbMigrationJob.update({
            where: { id: jobId },
            data: {
              state: 'succeeded',
              validationStats: completedValidationStats,
              completedAt: new Date(),
              lastError: null,
            },
          });
        });
        await this.dataDbClientManager.invalidateConnection(job.targetConnectionId);
        await this.cleanupSourceDeltaCaptureForJob(job).catch(() => undefined);
        return {
          state: 'succeeded',
          validationStats: completedValidationStats,
        };
      }

      await this.migrationJobClient.spaceDataDbMigrationJob.update({
        where: { id: jobId },
        data: {
          state: 'switching',
          lastError: null,
        },
      });

      switchedAt = new Date();
      completedValidationStats = {
        ...completedValidationStats,
        switched: true,
        switchedAt: switchedAt.toISOString(),
      };
      await runTransaction(async (prisma) => {
        await prisma.dataDbConnection.update({
          where: { id: job.targetConnectionId },
          data: {
            status: 'ready',
            lastValidatedAt: new Date(),
            lastError: null,
          },
        });
        for (const spaceId of spaceIds) {
          await prisma.spaceDataDbBinding.upsert({
            where: { spaceId },
            create: {
              spaceId,
              dataDbConnectionId: job.targetConnectionId,
              mode: 'byodb',
              state: 'ready',
              createdBy: job.createdBy,
            },
            update: {
              dataDbConnectionId: job.targetConnectionId,
              mode: 'byodb',
              state: 'ready',
            },
          });
        }
      });
    } catch (error) {
      const lastError = error instanceof Error ? error.message : String(error);
      await this.migrationJobClient.spaceDataDbMigrationJob.update({
        where: { id: jobId },
        data: {
          state: 'failed',
          lastError,
        },
      });
      throw error;
    }

    await this.dataDbClientManager.invalidateConnection(job.targetConnectionId);
    if (job.sourceConnectionId) {
      await this.dataDbClientManager.invalidateConnection(job.sourceConnectionId);
    }
    try {
      await this.resumeTargetComputedForJob(jobId);
    } catch (error) {
      completedValidationStats = {
        ...completedValidationStats,
        warnings: [
          ...(completedValidationStats.warnings ?? []),
          `target_computed_resume_failed: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
    await this.migrationJobClient.spaceDataDbMigrationJob.update({
      where: { id: jobId },
      data: {
        state: 'succeeded',
        validationStats: completedValidationStats,
        completedAt: switchedAt ?? new Date(),
        lastError: null,
      },
    });
    await this.cleanupSourceDeltaCaptureForJob(job).catch(() => undefined);
    return {
      state: 'succeeded',
      validationStats: completedValidationStats,
    };
  }

  async validateCopyForJob(
    jobId: string,
    options: { keepWriteGate?: boolean } = {}
  ): Promise<IValidationStats> {
    const job = await this.getMigrationJob(jobId);
    if (!job.targetConnection?.encryptedUrl) {
      throw new CustomHttpException(
        `Migration job ${jobId} has no target connection`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }

    const inventory = this.normalizeInventory(job.inventory, job.spaceId);
    const sourceDataDb = await this.getSourceDataDbForJob(job);
    const sourceSchema = sourceDataDb.internalSchema ?? 'public';
    const targetConnection = job.targetConnection;
    const targetUrl = decryptDataDbUrl(targetConnection.encryptedUrl);
    const startedAt = new Date().toISOString();
    const progressPollMs = readPositiveIntEnv(
      'BYODB_SPACE_DATA_DB_COPY_PROGRESS_POLL_MS',
      defaultCopyProgressPollMs
    );

    await this.migrationJobClient.spaceDataDbMigrationJob.update({
      where: { id: jobId },
      data: {
        state: options.keepWriteGate ? 'freezing_writes' : 'validating',
        validationStats: {
          phase: 'validating_copy',
          progress: this.buildMigrationProgress(job, inventory, 'validating_copy'),
          startedAt,
        },
        lastError: null,
      },
    });

    const sourceClient = this.clientFactory(sourceDataDb.url);
    const targetClient = this.clientFactory(targetUrl);
    try {
      const validationStartSeq = await this.tryGetSourceDeltaMaxSeq(
        sourceClient,
        sourceSchema,
        jobId
      );
      const validation = await this.withMigrationHeartbeat(
        () =>
          this.updateValidationHeartbeat(
            job,
            inventory,
            {
              stage: 'validating_copy',
              updatedAt: new Date().toISOString(),
            },
            options
          ),
        () =>
          this.validateCopiedData({
            sourceClient,
            targetClient,
            sourceSchema,
            targetSchema: job.targetInternalSchema,
            targetConnectionId: job.targetConnectionId,
            targetEncryptedUrl: targetConnection.encryptedUrl,
            inventory,
            spaceId: job.spaceId,
          }),
        progressPollMs
      );
      const validationEndSeq = await this.tryGetSourceDeltaMaxSeq(
        sourceClient,
        sourceSchema,
        jobId
      );
      const sourceChangedDuringValidation =
        !options.keepWriteGate &&
        validationStartSeq != null &&
        validationEndSeq != null &&
        validationEndSeq > validationStartSeq;

      if (validation.mismatches.length && !sourceChangedDuringValidation) {
        await this.migrationJobClient.spaceDataDbMigrationJob.update({
          where: { id: jobId },
          data: {
            state: 'failed',
            validationStats: {
              phase: 'validation_failed',
              progress: this.buildMigrationProgress(job, inventory, 'validation_failed'),
              mismatches: validation.mismatches,
              failedAt: new Date().toISOString(),
            },
            lastError: validationFailedMessage,
          },
        });
        throw new CustomHttpException(validationFailedMessage, HttpErrorCode.CONFLICT, {
          errorCode: spaceDataDbValidationMismatchErrorCode,
          mismatches: validation.mismatches,
          spaceId: job.spaceId,
        });
      }

      const validationStats: IValidationStats = {
        phase: 'validation_completed',
        progress: this.buildMigrationProgress(job, inventory, 'validation_completed'),
        targetSchemaVersion: validation.targetSchemaVersion,
        routeSmoke: validation.routeSmoke,
        baseSchemas: validation.baseSchemas,
        sharedTables: validation.sharedTables,
        undoFunction: validation.undoFunction,
        ...(sourceChangedDuringValidation
          ? {
              warnings: ['source_changed_during_validation'],
              mismatches: validation.mismatches,
              sourceDelta: {
                validationStartSeq,
                validationEndSeq,
              },
            }
          : {}),
        completedAt: new Date().toISOString(),
      };
      await this.migrationJobClient.spaceDataDbMigrationJob.update({
        where: { id: jobId },
        data: {
          state: options.keepWriteGate ? 'freezing_writes' : 'validating',
          validationStats,
          lastError: null,
        },
      });
      return validationStats;
    } catch (error) {
      if (error instanceof CustomHttpException) {
        throw error;
      }

      const lastError = error instanceof Error ? error.message : String(error);
      await this.migrationJobClient.spaceDataDbMigrationJob.update({
        where: { id: jobId },
        data: {
          state: 'failed',
          validationStats: {
            phase: 'validation_failed',
            progress: this.buildMigrationProgress(job, inventory, 'validation_failed'),
            failedAt: new Date().toISOString(),
          },
          lastError,
        },
      });
      throw error;
    } finally {
      await Promise.all([
        sourceClient.destroy().catch(() => undefined),
        targetClient.destroy().catch(() => undefined),
      ]);
    }
  }

  private async updateValidationHeartbeat(
    job: IMigrationJobRecord,
    inventory: ISpaceDataDbInventory,
    heartbeat: IValidationHeartbeat,
    options: { keepWriteGate?: boolean } = {}
  ) {
    await this.migrationJobClient.spaceDataDbMigrationJob
      .update({
        where: { id: job.id },
        data: {
          state: options.keepWriteGate ? 'freezing_writes' : 'validating',
          validationStats: {
            phase: 'validating_copy',
            progress: this.buildMigrationProgress(job, inventory, 'validating_copy'),
            heartbeat,
          },
          lastError: null,
        },
      })
      .catch(() => undefined);
  }

  private async assertNoActiveMigrationForSpaces(spaceIds: string[], requestedSpaceId: string) {
    const directJob = await this.migrationJobClient.spaceDataDbMigrationJob.findFirst({
      where: {
        spaceId: { in: spaceIds },
        state: { in: [...activeSpaceDataDbMigrationStates] },
      },
      select: { id: true, state: true },
    });
    const activeJob =
      directJob ??
      (
        await this.migrationJobClient.spaceDataDbMigrationJob.findMany({
          where: {
            state: { in: [...activeSpaceDataDbMigrationStates] },
          },
          include: { targetConnection: true },
        })
      ).find((job) =>
        this.getInventorySpaceIds(this.normalizeInventory(job.inventory, job.spaceId)).some(
          (spaceId) => spaceIds.includes(spaceId)
        )
      );
    if (!activeJob) {
      return;
    }

    throw new CustomHttpException(
      'A space data database migration is already active',
      HttpErrorCode.CONFLICT,
      {
        errorCode: spaceDataDbMigrationActiveErrorCode,
        migrationJobId: activeJob.id,
        migrationState: activeJob.state,
        spaceId: requestedSpaceId,
        relatedSpaceIds: spaceIds,
      }
    );
  }

  private async assertMigrationNotCanceled(jobId: string, spaceId?: string) {
    const job = await this.getMigrationState(jobId);

    if (job?.state !== 'canceled') {
      return;
    }

    throw new CustomHttpException(
      `Space data database migration job ${jobId} was canceled`,
      HttpErrorCode.CONFLICT,
      {
        errorCode: spaceDataDbMigrationCanceledErrorCode,
        migrationJobId: jobId,
        spaceId: spaceId ?? job.spaceId,
      }
    );
  }

  private buildCancelableProcessOptions(
    jobId: string,
    timeoutMs?: number,
    pollMs?: number
  ): ISpaceDataDbProcessRunOptions {
    return {
      timeoutMs,
      pollMs,
      pollTimeoutMs: pollMs
        ? readPositiveIntEnv(
            'BYODB_SPACE_DATA_DB_PROCESS_POLL_TIMEOUT_MS',
            Math.max(defaultCopyProgressPollTimeoutMs, pollMs * 6)
          )
        : undefined,
      pollFailureTimeoutMs: pollMs
        ? readPositiveIntEnv(
            'BYODB_SPACE_DATA_DB_PROCESS_POLL_FAILURE_TIMEOUT_MS',
            Math.max(defaultCopyProgressPollTimeoutMs, pollMs * 6)
          )
        : undefined,
      shouldCancel: () => this.isMigrationCanceled(jobId),
    };
  }

  private async isProcessCancelErrorForJob(error: unknown, jobId: string) {
    if (
      error instanceof SpaceDataDbProcessCanceledError ||
      error instanceof SpaceDataDbProcessPipelineCanceledError
    ) {
      return true;
    }
    return await this.isMigrationCanceled(jobId);
  }

  private async isMigrationCanceled(jobId: string) {
    return (await this.getMigrationState(jobId))?.state === 'canceled';
  }

  private async getMigrationState(jobId: string) {
    return (await this.migrationJobClient.spaceDataDbMigrationJob.findFirst({
      where: { id: jobId },
      select: { id: true, state: true, spaceId: true },
    })) as { id: string; state: string; spaceId?: string } | null;
  }

  private async completeFailedMigrationJob(jobId: string, error: unknown) {
    const current = await this.getMigrationState(jobId);
    if (!current || ['succeeded', 'canceled', 'rolled_back'].includes(current.state)) {
      return;
    }
    if (
      current.state !== 'failed' &&
      !activeSpaceDataDbMigrationStates.includes(current.state as never)
    ) {
      return;
    }

    await this.migrationJobClient.spaceDataDbMigrationJob.updateMany({
      where: { id: jobId, state: current.state },
      data: {
        state: 'failed',
        completedAt: new Date(),
        lastError: error instanceof Error ? error.message : String(error),
      },
    });
  }

  private assertSpacesCanJoinTargetDataDb(
    relatedSpaces: ISpaceDataDbRelatedSpaces,
    targetDatabaseFingerprint: string,
    requestedSpaceId: string
  ) {
    const mismatched = relatedSpaces.spaces.filter(
      (space) =>
        space.dataDbMode === 'byodb' &&
        space.dataDbDatabaseFingerprint !== targetDatabaseFingerprint
    );
    if (!mismatched.length) {
      return;
    }

    throw new CustomHttpException(
      'Cross-space linked spaces must use the same BYODB data database URL',
      HttpErrorCode.CONFLICT,
      {
        errorCode: spaceDataDbRelatedSpacesRequiredErrorCode,
        spaceId: requestedSpaceId,
        targetDatabaseFingerprint,
        relatedSpaces,
        mismatchedSpaceIds: mismatched.map((space) => space.spaceId),
      }
    );
  }

  private assertRelatedSpacesCanMigrateTogether(
    spaceId: string,
    relatedSpaces: ISpaceDataDbRelatedSpaces
  ) {
    const primary = relatedSpaces.spaces.find((space) => space.spaceId === spaceId);
    if (primary) {
      return;
    }

    throw new CustomHttpException(`Space ${spaceId} not found`, HttpErrorCode.NOT_FOUND);
  }

  private getRelatedSpaceIds(relatedSpaces: ISpaceDataDbRelatedSpaces) {
    return relatedSpaces.spaces.map((space) => space.spaceId).sort();
  }

  private getInventorySpaceIds(inventory: ISpaceDataDbInventory) {
    return inventory.spaceIds.length
      ? inventory.spaceIds
      : [inventory.relatedSpaces.primarySpaceId];
  }

  private getInventoryCopySpaceIds(inventory: ISpaceDataDbInventory) {
    return inventory.copySpaceIds.length
      ? inventory.copySpaceIds
      : this.getInventorySpaceIds(inventory);
  }

  private getRelatedSpaceIdsForCopy(
    relatedSpaces: ISpaceDataDbRelatedSpaces,
    targetUrlFingerprint: string
  ) {
    return relatedSpaces.spaces
      .filter(
        (space) =>
          space.dataDbMode !== 'byodb' || space.dataDbUrlFingerprint !== targetUrlFingerprint
      )
      .map((space) => space.spaceId)
      .sort();
  }

  private assertRequestedSpaceIsCopySource(spaceId: string, copySpaceIds: string[]) {
    if (copySpaceIds.includes(spaceId)) {
      return;
    }

    throw new CustomHttpException(
      'Start migration from a related space that still uses the default data database',
      HttpErrorCode.CONFLICT,
      {
        errorCode: spaceDataDbRelatedSpacesRequiredErrorCode,
        spaceId,
        copySpaceIds,
      }
    );
  }

  private resolveMigrationTargetInternalSchema(
    dataDb: IDataDbPreflightRo,
    relatedSpaces: ISpaceDataDbRelatedSpaces,
    targetDatabaseFingerprint: string,
    requestedSpaceId: string
  ) {
    const requested = resolveDataDbInternalSchema(dataDb.internalSchema, dataDb.url);
    if (dataDb.internalSchema?.trim()) {
      return requested;
    }

    const relatedTargetSchemas = Array.from(
      new Set(
        relatedSpaces.spaces
          .filter(
            (space) =>
              space.dataDbMode === 'byodb' &&
              space.dataDbDatabaseFingerprint === targetDatabaseFingerprint &&
              space.dataDbInternalSchema
          )
          .map((space) => space.dataDbInternalSchema as string)
      )
    ).sort();

    if (relatedTargetSchemas.length <= 1) {
      return relatedTargetSchemas[0] ?? requested;
    }

    throw new CustomHttpException(
      'Cross-space linked spaces must use a single BYODB internal schema before repair migration',
      HttpErrorCode.CONFLICT,
      {
        errorCode: spaceDataDbRelatedSpacesRequiredErrorCode,
        spaceId: requestedSpaceId,
        targetDatabaseFingerprint,
        relatedSpaces,
        internalSchemas: relatedTargetSchemas,
      }
    );
  }

  private async resolveMigrationTargetInternalSchemaOrThrow(
    dataDb: IDataDbPreflightRo,
    relatedSpaces: ISpaceDataDbRelatedSpaces,
    targetDatabaseFingerprint: string,
    requestedSpaceId: string
  ) {
    try {
      return this.resolveMigrationTargetInternalSchema(
        dataDb,
        relatedSpaces,
        targetDatabaseFingerprint,
        requestedSpaceId
      );
    } catch (error) {
      if (error instanceof CustomHttpException) {
        throw error;
      }
      const preflight = await this.preflightService.preflight({
        ...dataDb,
        targetMode: migrateSpaceTargetMode,
      });
      if (!preflight.ok) {
        throw this.buildMigrationPreflightException(preflight);
      }
      throw new CustomHttpException(
        this.sanitizeTargetErrorMessage(error, dataDb.url),
        HttpErrorCode.VALIDATION_ERROR,
        { preflight }
      );
    }
  }

  private async runTargetPreflightOperation<T>(
    dataDb: IDataDbPreflightRo,
    internalSchema: string,
    spaceId: string,
    operation: string,
    action: () => Promise<T>
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof CustomHttpException) {
        throw error;
      }
      const preflight = await this.preflightService.preflight({
        ...dataDb,
        targetMode: migrateSpaceTargetMode,
        internalSchema,
      });
      if (!preflight.ok) {
        throw this.buildMigrationPreflightException(preflight);
      }
      throw new CustomHttpException(
        'Target BYODB database operation failed before migration could be queued',
        HttpErrorCode.CONFLICT,
        {
          errorCode: spaceDataDbTargetConflictErrorCode,
          operation,
          spaceId,
          internalSchema,
          targetError: this.sanitizeTargetErrorMessage(error, dataDb.url),
          preflight,
        }
      );
    }
  }

  private buildMigrationPreflightException(preflight: IDataDbPreflightVo) {
    return new CustomHttpException(buildPreflightErrorMessage(preflight), HttpErrorCode.CONFLICT, {
      preflight,
    });
  }

  private sanitizeTargetErrorMessage(error: unknown, rawUrl: string) {
    const message = error instanceof Error ? error.message : String(error);
    return message
      .replace(rawUrl, '[redacted]')
      .replace(/postgresql:\/\/[^@\s]+@/g, 'postgresql://***@')
      .slice(0, 1000);
  }

  private assertRelatedSpacesShareSameTarget(
    relatedSpaces: ISpaceDataDbRelatedSpaces,
    targetUrlFingerprint: string,
    requestedSpaceId: string
  ) {
    const mismatched = relatedSpaces.spaces.filter(
      (space) => space.dataDbMode === 'byodb' && space.dataDbUrlFingerprint !== targetUrlFingerprint
    );
    if (!mismatched.length) {
      return;
    }

    throw new CustomHttpException(
      'Cross-space linked spaces must use the same BYODB data database URL',
      HttpErrorCode.CONFLICT,
      {
        errorCode: spaceDataDbRelatedSpacesRequiredErrorCode,
        spaceId: requestedSpaceId,
        targetUrlFingerprint,
        relatedSpaces,
        mismatchedSpaceIds: mismatched.map((space) => space.spaceId),
      }
    );
  }

  private async buildInventory(
    spaceId: string,
    targetInternalSchema: string,
    relatedSpaces?: ISpaceDataDbRelatedSpaces,
    options: { copySpaceIds?: string[] } = {}
  ): Promise<ISpaceDataDbInventory> {
    const resolvedRelatedSpaces =
      relatedSpaces ?? (await resolveSpaceDataDbRelatedSpaces(this.prismaService, spaceId));
    this.assertRelatedSpacesCanMigrateTogether(spaceId, resolvedRelatedSpaces);
    const spaceIds = this.getRelatedSpaceIds(resolvedRelatedSpaces);
    const copySpaceIdSet = new Set(options.copySpaceIds?.length ? options.copySpaceIds : spaceIds);
    const copySpaces = resolvedRelatedSpaces.spaces.filter((space) =>
      copySpaceIdSet.has(space.spaceId)
    );
    const copySpaceIds = copySpaces.map((space) => space.spaceId).sort();
    const baseIds = copySpaces.flatMap((space) => space.baseIds).sort();
    const tableIds = copySpaces.flatMap((space) => space.tableIds).sort();
    const relatedBaseIds = resolvedRelatedSpaces.spaces.flatMap((space) => space.baseIds).sort();
    const [tables, sharedTableIds, relatedSharedTableIds] = await Promise.all([
      this.prismaService.tableMeta.findMany({
        where: { id: { in: tableIds }, deletedTime: null },
        select: { id: true, dbTableName: true },
        orderBy: { id: 'asc' },
      }),
      this.findSharedTableIdsForBases(baseIds),
      this.findSharedTableIdsForBases(relatedBaseIds),
    ]);

    const sourceDataDb = await this.dataDbClientManager.getDataDatabaseForSpace(spaceId);
    const dataPrisma = (await this.dataDbClientManager.dataPrismaForSpace(
      spaceId
    )) as IDataPrismaIntrospectionClient;
    const [physicalSchemas, postgresExtensionDependencies, outOfScopeForeignKeys] =
      await Promise.all([
        this.inspectSourcePhysicalSchemas(baseIds, dataPrisma),
        this.inspectSourcePostgresExtensionDependencies(baseIds, dataPrisma),
        this.inspectSourceOutOfScopeForeignKeys(baseIds, dataPrisma),
      ]);

    return {
      sourceDataDb: this.buildSourceDataDbInventory(sourceDataDb),
      targetDataDb: {
        internalSchema: targetInternalSchema,
      },
      relatedSpaces: resolvedRelatedSpaces,
      spaceIds,
      copySpaceIds,
      baseIds,
      tableIds,
      sharedTableIds,
      relatedSharedTableIds,
      dbTableNames: tables.map((table) => table.dbTableName).sort(),
      physicalSchemas,
      postgresExtensionDependencies,
      outOfScopeForeignKeys,
      estimatedTotalBytes: physicalSchemas.reduce((sum, schema) => sum + schema.totalBytes, 0),
      estimatedTotalRows: physicalSchemas.reduce((sum, schema) => sum + schema.estimatedRows, 0),
    };
  }

  private normalizeInventory(
    inventory: unknown,
    fallbackSpaceId: string = ''
  ): ISpaceDataDbInventory {
    const candidate = (inventory ?? {}) as Partial<ISpaceDataDbInventory>;
    const sourceDataDb = this.normalizeInventorySourceDataDb(candidate.sourceDataDb);
    const targetDataDb = this.normalizeInventoryTargetDataDb(candidate.targetDataDb);
    const physicalSchemas = candidate.physicalSchemas ?? [];
    const relatedSpaces = this.normalizeInventoryRelatedSpaces(candidate, fallbackSpaceId);
    const spaceIds = this.normalizeInventorySpaceIds(candidate, relatedSpaces);
    const copySpaceIds = candidate.copySpaceIds?.length ? candidate.copySpaceIds : spaceIds;
    const tableIds = candidate.tableIds ?? [];
    const sharedTableIds = candidate.sharedTableIds ?? tableIds;
    const relatedSharedTableIds = this.normalizeInventoryRelatedSharedTableIds(
      candidate,
      relatedSpaces,
      sharedTableIds
    );
    return {
      sourceDataDb: {
        mode: sourceDataDb.mode ?? 'default',
        cacheKey: sourceDataDb.cacheKey ?? metaFallbackDataDbCacheKey,
        connectionId: sourceDataDb.connectionId ?? null,
        internalSchema: sourceDataDb.internalSchema ?? null,
        isMetaFallback: sourceDataDb.isMetaFallback ?? true,
      },
      targetDataDb: {
        internalSchema: targetDataDb.internalSchema,
      },
      relatedSpaces,
      spaceIds,
      copySpaceIds,
      baseIds: candidate.baseIds ?? [],
      tableIds,
      sharedTableIds,
      relatedSharedTableIds,
      dbTableNames: candidate.dbTableNames ?? [],
      physicalSchemas,
      postgresExtensionDependencies: candidate.postgresExtensionDependencies ?? [],
      outOfScopeForeignKeys: candidate.outOfScopeForeignKeys ?? [],
      estimatedTotalBytes:
        candidate.estimatedTotalBytes ??
        physicalSchemas.reduce((sum, schema) => sum + (schema.totalBytes ?? 0), 0),
      estimatedTotalRows:
        candidate.estimatedTotalRows ??
        physicalSchemas.reduce((sum, schema) => sum + (schema.estimatedRows ?? 0), 0),
    };
  }

  private normalizeInventorySourceDataDb(sourceDataDb: unknown): ISpaceDataDbInventorySourceDataDb {
    const candidate = (sourceDataDb ?? {}) as Partial<ISpaceDataDbInventorySourceDataDb>;
    return {
      mode: candidate.mode ?? 'default',
      cacheKey: candidate.cacheKey ?? metaFallbackDataDbCacheKey,
      connectionId: candidate.connectionId ?? null,
      internalSchema: candidate.internalSchema ?? null,
      isMetaFallback: candidate.isMetaFallback ?? true,
    };
  }

  private normalizeInventoryTargetDataDb(targetDataDb: unknown): ISpaceDataDbInventoryTargetDataDb {
    const candidate = (targetDataDb ?? {}) as Partial<ISpaceDataDbInventoryTargetDataDb>;
    return {
      internalSchema: candidate.internalSchema ?? '',
    };
  }

  private normalizeInventoryRelatedSpaces(
    candidate: Partial<ISpaceDataDbInventory>,
    fallbackSpaceId: string
  ): ISpaceDataDbInventoryRelatedSpaces {
    const relatedSpaces = candidate.relatedSpaces as ISpaceDataDbInventoryRelatedSpaces | undefined;
    if (relatedSpaces) {
      return relatedSpaces;
    }

    return {
      primarySpaceId: fallbackSpaceId,
      hasCrossSpaceLinks: false,
      spaces: [],
      links: [],
    };
  }

  private normalizeInventorySpaceIds(
    candidate: Partial<ISpaceDataDbInventory>,
    relatedSpaces: ISpaceDataDbInventoryRelatedSpaces
  ) {
    if (candidate.spaceIds?.length) {
      return candidate.spaceIds;
    }
    if (relatedSpaces.spaces.length) {
      return relatedSpaces.spaces.map((space) => space.spaceId);
    }
    return relatedSpaces.primarySpaceId ? [relatedSpaces.primarySpaceId] : [];
  }

  private normalizeInventoryRelatedSharedTableIds(
    candidate: Partial<ISpaceDataDbInventory>,
    relatedSpaces: ISpaceDataDbInventoryRelatedSpaces,
    sharedTableIds: string[]
  ) {
    if (candidate.relatedSharedTableIds) {
      return candidate.relatedSharedTableIds;
    }
    if (!relatedSpaces.spaces.length) {
      return sharedTableIds;
    }
    return [...new Set(relatedSpaces.spaces.flatMap((space) => space.tableIds ?? []))].sort();
  }

  private buildMigrationProgress(
    job: IMigrationJobRecord,
    inventory: ISpaceDataDbInventory,
    phase: string,
    detail?: ISpaceDataDbMigrationProgressDetail
  ): IMigrationProgressStats {
    const completedSteps = migrationProgressCompletedSteps[phase] ?? 0;
    const baseCopyCompleted =
      completedSteps >= migrationProgressCompletedSteps.base_schemas_completed;
    const updatedAt = new Date();
    const startedAt = job.startedAt ?? null;
    const elapsedMs = startedAt ? Math.max(0, updatedAt.getTime() - startedAt.getTime()) : null;
    const { stage, percent } = buildSpaceDataDbMigrationPercent(phase, detail);
    const tracked = this.migrationProgressTracker.track(job.id, {
      percent,
      copiedBytes: detail?.copiedBytes ?? null,
      nowMs: updatedAt.getTime(),
      elapsedMs,
    });
    if (isTerminalSpaceDataDbMigrationPhase(phase)) {
      this.migrationProgressTracker.clear(job.id);
    }

    return {
      phase,
      totalSteps: migrationProgressTotalSteps,
      completedSteps,
      percent: tracked.percent,
      stage,
      stages: spaceDataDbMigrationStages,
      estimatedTotalBytes: inventory.estimatedTotalBytes,
      completedEstimatedBytes: baseCopyCompleted ? inventory.estimatedTotalBytes : 0,
      estimatedTotalRows: inventory.estimatedTotalRows,
      completedEstimatedRows: baseCopyCompleted ? inventory.estimatedTotalRows : 0,
      copiedBytes:
        tracked.copiedBytes ?? (baseCopyCompleted ? inventory.estimatedTotalBytes : null),
      bytesPerSecond: tracked.bytesPerSecond,
      startedAt: this.toNullableIso(startedAt),
      updatedAt: updatedAt.toISOString(),
      etaMs: tracked.etaMs,
    };
  }

  private compareInventoryForCopy(
    expected: ISpaceDataDbInventory,
    actual: ISpaceDataDbInventory,
    options: { compareSharedScope?: boolean } = {}
  ): IInventoryChangedMismatch[] {
    const mismatches: IInventoryChangedMismatch[] = [];
    this.collectObjectMismatch(
      mismatches,
      'sourceDataDb',
      expected.sourceDataDb,
      actual.sourceDataDb
    );
    this.collectObjectMismatch(
      mismatches,
      'targetDataDb',
      expected.targetDataDb,
      actual.targetDataDb
    );
    this.collectListMismatch(mismatches, 'spaceIds', expected.spaceIds, actual.spaceIds);
    this.collectListMismatch(
      mismatches,
      'copySpaceIds',
      expected.copySpaceIds,
      actual.copySpaceIds
    );
    if (expected.relatedSpaces.spaces.length || expected.relatedSpaces.links.length) {
      this.collectObjectMismatch(
        mismatches,
        'relatedSpaces',
        expected.relatedSpaces,
        actual.relatedSpaces
      );
    }
    this.collectListMismatch(mismatches, 'baseIds', expected.baseIds, actual.baseIds);
    this.collectListMismatch(mismatches, 'tableIds', expected.tableIds, actual.tableIds);
    if (options.compareSharedScope) {
      this.collectListMismatch(
        mismatches,
        'sharedTableIds',
        expected.sharedTableIds,
        actual.sharedTableIds
      );
      this.collectListMismatch(
        mismatches,
        'relatedSharedTableIds',
        expected.relatedSharedTableIds,
        actual.relatedSharedTableIds
      );
    }
    this.collectListMismatch(
      mismatches,
      'dbTableNames',
      expected.dbTableNames,
      actual.dbTableNames
    );
    this.collectListMismatch(
      mismatches,
      'physicalRelations',
      this.buildPhysicalRelationKeys(expected),
      this.buildPhysicalRelationKeys(actual)
    );
    this.collectObjectMismatch(
      mismatches,
      'postgresExtensionDependencies',
      expected.postgresExtensionDependencies,
      actual.postgresExtensionDependencies
    );
    this.collectObjectMismatch(
      mismatches,
      'outOfScopeForeignKeys',
      expected.outOfScopeForeignKeys,
      actual.outOfScopeForeignKeys
    );
    return mismatches;
  }

  private collectObjectMismatch(
    mismatches: IInventoryChangedMismatch[],
    object: string,
    expected: unknown,
    actual: unknown
  ) {
    if (stableJsonStringify(expected) === stableJsonStringify(actual)) {
      return;
    }
    mismatches.push({
      object,
      reason: 'inventory_changed',
      expected,
      actual,
    });
  }

  private collectListMismatch(
    mismatches: IInventoryChangedMismatch[],
    object: string,
    expected: string[],
    actual: string[]
  ) {
    const sortedExpected = [...expected].sort();
    const sortedActual = [...actual].sort();
    if (JSON.stringify(sortedExpected) === JSON.stringify(sortedActual)) {
      return;
    }

    const expectedSet = new Set(sortedExpected);
    const actualSet = new Set(sortedActual);
    mismatches.push({
      object,
      reason: 'inventory_changed',
      expectedCount: sortedExpected.length,
      actualCount: sortedActual.length,
      added: sortedActual.filter((value) => !expectedSet.has(value)).slice(0, 5),
      removed: sortedExpected.filter((value) => !actualSet.has(value)).slice(0, 5),
    });
  }

  private buildPhysicalRelationKeys(inventory: ISpaceDataDbInventory) {
    return inventory.physicalSchemas
      .flatMap((schema) =>
        schema.relations.map(
          (relation) => `${relation.schemaName}.${relation.relationName}:${relation.relationKind}`
        )
      )
      .sort();
  }

  private async findSharedTableIdsForBases(baseIds: string[]): Promise<string[]> {
    if (!baseIds.length) {
      return [];
    }

    const rows = await this.prismaService.tableMeta.findMany({
      where: { baseId: { in: baseIds } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    return [...new Set(rows.map((row) => row.id))].sort();
  }

  private buildSourceDataDbInventory(
    sourceDataDb: IResolvedDataDatabase
  ): ISpaceDataDbInventorySourceDataDb {
    return {
      mode: sourceDataDb.isMetaFallback ? 'default' : 'byodb',
      cacheKey: sourceDataDb.cacheKey,
      connectionId: sourceDataDb.connectionId ?? null,
      internalSchema: sourceDataDb.internalSchema ?? null,
      isMetaFallback: sourceDataDb.isMetaFallback,
    };
  }

  private async inspectSourcePhysicalSchemas(
    baseIds: string[],
    dataPrisma: IDataPrismaIntrospectionClient
  ): Promise<ISpaceDataDbPhysicalSchema[]> {
    if (!baseIds.length) {
      return [];
    }

    const rows = normalizeRawRows<{
      schemaName: string;
      relationName: string;
      relationKind: string;
      totalBytes: string | number | bigint | null;
      estimatedRows: string | number | bigint | null;
    }>(
      await dataPrisma.$queryRawUnsafe(
        `
          SELECT
            n.nspname AS "schemaName",
            c.relname AS "relationName",
            CASE c.relkind
              WHEN 'r' THEN 'table'
              WHEN 'p' THEN 'partitioned_table'
              WHEN 'S' THEN 'sequence'
              WHEN 'v' THEN 'view'
              WHEN 'm' THEN 'materialized_view'
              WHEN 'f' THEN 'foreign_table'
              ELSE c.relkind::text
            END AS "relationKind",
            pg_total_relation_size(c.oid)::text AS "totalBytes",
            CASE
              WHEN c.relkind IN ('r', 'p', 'f') THEN GREATEST(c.reltuples, 0)::bigint::text
              ELSE NULL
            END AS "estimatedRows"
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ANY($1::text[])
            AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
          ORDER BY n.nspname ASC, c.relname ASC
        `,
        baseIds
      )
    );

    const schemaMap = new Map<string, ISpaceDataDbPhysicalSchema>();
    for (const row of rows) {
      const schema = schemaMap.get(row.schemaName) ?? {
        schemaName: row.schemaName,
        relations: [],
        totalBytes: 0,
        estimatedRows: 0,
      };
      const relation = {
        schemaName: row.schemaName,
        relationName: row.relationName,
        relationKind: row.relationKind,
        totalBytes: Number(row.totalBytes ?? 0),
        estimatedRows: row.estimatedRows == null ? null : Number(row.estimatedRows),
      };
      schema.relations.push(relation);
      schema.totalBytes += relation.totalBytes;
      schema.estimatedRows += relation.estimatedRows ?? 0;
      schemaMap.set(row.schemaName, schema);
    }

    return Array.from(schemaMap.values()).sort((left, right) =>
      left.schemaName.localeCompare(right.schemaName)
    );
  }

  private async inspectSourcePostgresExtensionDependencies(
    baseIds: string[],
    dataPrisma: IDataPrismaIntrospectionClient
  ): Promise<ISpaceDataDbPostgresExtensionDependency[]> {
    if (!baseIds.length) {
      return [];
    }

    const rows = normalizeRawRows<{
      extensionName?: string;
      objectType?: string;
      schemaName?: string;
      objectName?: string;
      accessMethod?: string;
      sourceSchemaName?: string;
      sourceRelationName?: string;
      sourceIndexName?: string;
    }>(
      await dataPrisma.$queryRawUnsafe(
        `
          WITH source_indexes AS (
            SELECT
              tn.nspname AS "sourceSchemaName",
              tc.relname AS "sourceRelationName",
              ic.relname AS "sourceIndexName",
              pg_get_indexdef(i.indexrelid) AS "definition"
            FROM pg_index i
            JOIN pg_class tc ON tc.oid = i.indrelid
            JOIN pg_namespace tn ON tn.oid = tc.relnamespace
            JOIN pg_class ic ON ic.oid = i.indexrelid
            WHERE tn.nspname = ANY($1::text[])
          )
          SELECT
            'pg_trgm' AS "extensionName",
            'operator_class' AS "objectType",
            'public' AS "schemaName",
            'gin_trgm_ops' AS "objectName",
            'gin' AS "accessMethod",
            "sourceSchemaName",
            "sourceRelationName",
            "sourceIndexName"
          FROM source_indexes
          WHERE position('gin_trgm_ops' in "definition") > 0
          ORDER BY "sourceSchemaName" ASC, "sourceRelationName" ASC, "sourceIndexName" ASC
        `,
        baseIds
      )
    );

    const dependencyMap = new Map<string, ISpaceDataDbPostgresExtensionDependency>();
    for (const row of rows) {
      if (
        row.extensionName !== 'pg_trgm' ||
        row.objectType !== 'operator_class' ||
        !row.schemaName ||
        !row.objectName ||
        !row.accessMethod
      ) {
        continue;
      }

      const key = [
        row.extensionName,
        row.objectType,
        row.schemaName,
        row.objectName,
        row.accessMethod,
      ].join(':');
      const dependency = dependencyMap.get(key) ?? {
        extensionName: row.extensionName,
        objectType: 'operator_class',
        schemaName: row.schemaName,
        objectName: row.objectName,
        accessMethod: row.accessMethod,
        sourceObjects: [],
      };
      if (row.sourceSchemaName && row.sourceRelationName && row.sourceIndexName) {
        dependency.sourceObjects.push(
          `${row.sourceSchemaName}.${row.sourceRelationName}.${row.sourceIndexName}`
        );
      }
      dependencyMap.set(key, dependency);
    }

    return Array.from(dependencyMap.values())
      .map((dependency) => ({
        ...dependency,
        sourceObjects: [...dependency.sourceObjects].sort().slice(0, 20),
      }))
      .sort((left, right) =>
        buildPostgresExtensionDependencyKey(left).localeCompare(
          buildPostgresExtensionDependencyKey(right)
        )
      );
  }

  private async inspectSourceOutOfScopeForeignKeys(
    baseIds: string[],
    dataPrisma: IDataPrismaIntrospectionClient
  ): Promise<ISpaceDataDbExcludedForeignKey[]> {
    if (!baseIds.length) {
      return [];
    }

    const rows = normalizeRawRows<Partial<ISpaceDataDbExcludedForeignKey>>(
      await dataPrisma.$queryRawUnsafe(
        `
          SELECT
            source_ns.nspname AS "schemaName",
            source_rel.relname AS "tableName",
            con.conname AS "constraintName",
            referenced_ns.nspname AS "referencedSchemaName",
            referenced_rel.relname AS "referencedTableName"
          FROM pg_constraint con
          JOIN pg_class source_rel ON source_rel.oid = con.conrelid
          JOIN pg_namespace source_ns ON source_ns.oid = source_rel.relnamespace
          JOIN pg_class referenced_rel ON referenced_rel.oid = con.confrelid
          JOIN pg_namespace referenced_ns ON referenced_ns.oid = referenced_rel.relnamespace
          WHERE con.contype = 'f'
            AND source_ns.nspname = ANY($1::text[])
            AND referenced_ns.nspname <> ALL($1::text[])
          ORDER BY
            source_ns.nspname ASC,
            source_rel.relname ASC,
            con.conname ASC,
            referenced_ns.nspname ASC,
            referenced_rel.relname ASC
        `,
        baseIds
      )
    );
    return rows
      .filter((row): row is ISpaceDataDbExcludedForeignKey =>
        Boolean(
          row.schemaName &&
            row.tableName &&
            row.constraintName &&
            row.referencedSchemaName &&
            row.referencedTableName
        )
      )
      .sort((left, right) =>
        [
          left.schemaName,
          left.tableName,
          left.constraintName,
          left.referencedSchemaName,
          left.referencedTableName,
        ]
          .join(':')
          .localeCompare(
            [
              right.schemaName,
              right.tableName,
              right.constraintName,
              right.referencedSchemaName,
              right.referencedTableName,
            ].join(':')
          )
      );
  }

  private async prepareMigrationTarget(
    url: string,
    internalSchema: string
  ): Promise<IPreparedMigrationTarget> {
    const preflight = await this.preflightService.preflight({
      url,
      targetMode: migrateSpaceTargetMode,
      internalSchema,
    });
    if (!preflight.ok) {
      throw new CustomHttpException(buildPreflightErrorMessage(preflight), HttpErrorCode.CONFLICT, {
        preflight,
      });
    }

    const schemaVersion = await this.baselineService.initialize(url, internalSchema);
    const { displayHost, displayDatabase } = getDatabaseUrlDisplayParts(url);
    return {
      encryptedUrl: encryptDataDbUrl(url),
      urlFingerprint: fingerprintDataDbConnection(url, internalSchema),
      displayHost,
      displayDatabase,
      internalSchema,
      schemaVersion,
      capabilities: preflight.capabilities,
    };
  }

  private async assertTargetHasNoSpaceConflicts(
    url: string,
    internalSchema: string,
    inventory: ISpaceDataDbInventory,
    spaceId: string
  ) {
    const client = this.clientFactory(url);
    try {
      const conflicts = await this.inspectTargetConflicts(client, internalSchema, inventory);
      if (!conflicts.length) {
        return;
      }

      throw new CustomHttpException(
        'Target BYODB database already contains objects for this space migration',
        HttpErrorCode.CONFLICT,
        {
          errorCode: spaceDataDbTargetConflictErrorCode,
          conflicts,
          spaceId,
        }
      );
    } finally {
      await client.destroy().catch(() => undefined);
    }
  }

  private async assertTargetSupportsSourceDependencies(
    url: string,
    inventory: ISpaceDataDbInventory,
    spaceId: string
  ) {
    const dependencies = inventory.postgresExtensionDependencies;
    if (!dependencies.length) {
      return;
    }

    const client = this.clientFactory(url);
    try {
      const installErrors = await this.tryInstallTargetPostgresExtensionDependencies(
        client,
        dependencies
      );
      const missingExtensions = await this.inspectMissingTargetExtensionDependencies(
        client,
        dependencies
      );
      if (!missingExtensions.length) {
        return;
      }

      const errors = missingExtensions.map((dependency) => {
        const installError = installErrors.find(
          (error) =>
            error.extensionName === dependency.extensionName &&
            error.schemaName === dependency.schemaName
        );
        const installErrorMessage = installError?.message
          ? ` Automatic installation failed: ${installError.message}`
          : '';
        return {
          code: 'MISSING_POSTGRES_EXTENSION',
          message: `Target database is missing ${dependency.schemaName}.${dependency.objectName}, required by source ${dependency.extensionName} indexes.${installErrorMessage}`,
          remediation:
            dependency.extensionName === 'pg_trgm'
              ? `Allow the migration connection to create pg_trgm, or install it before migration: CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA ${dependency.schemaName};`
              : `Install the ${dependency.extensionName} extension in the target database before migration.`,
        };
      });

      throw new CustomHttpException(
        'Target BYODB database is missing PostgreSQL extensions required by the source space',
        HttpErrorCode.CONFLICT,
        {
          errorCode: spaceDataDbTargetExtensionMissingErrorCode,
          errors,
          missingExtensions,
          requiredExtensions: dependencies,
          spaceId,
        }
      );
    } finally {
      await client.destroy().catch(() => undefined);
    }
  }

  private async tryInstallTargetPostgresExtensionDependencies(
    client: IDataDbPreflightClient,
    dependencies: ISpaceDataDbPostgresExtensionDependency[]
  ) {
    const errors: { extensionName: string; schemaName: string; message: string }[] = [];
    for (const target of this.getTargetPostgresExtensionInstallTargets(dependencies)) {
      for (const schemaName of target.schemaNames) {
        const error = await this.tryInstallTargetPostgresExtension(
          client,
          target.extensionName,
          schemaName
        );
        if (!error) {
          break;
        }
        errors.push(error);
      }
    }

    return errors;
  }

  private getTargetPostgresExtensionInstallTargets(
    dependencies: ISpaceDataDbPostgresExtensionDependency[]
  ) {
    const installTargets = new Map<string, { extensionName: string; schemaNames: string[] }>();
    for (const dependency of dependencies) {
      if (dependency.extensionName !== 'pg_trgm') {
        continue;
      }
      installTargets.set(dependency.extensionName, {
        extensionName: dependency.extensionName,
        schemaNames: [...new Set([dependency.schemaName, 'extensions'].filter(Boolean))],
      });
    }
    return [...installTargets.values()];
  }

  private async tryInstallTargetPostgresExtension(
    client: IDataDbPreflightClient,
    extensionName: string,
    schemaName: string
  ) {
    try {
      await client.raw(
        `CREATE EXTENSION IF NOT EXISTS ${quoteIdent(extensionName)} WITH SCHEMA ${quoteIdent(schemaName)}`
      );
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        extensionName,
        schemaName,
        message: message.length > 500 ? message.slice(message.length - 500) : message,
      };
    }
  }

  private async inspectMissingTargetExtensionDependencies(
    client: IDataDbPreflightClient,
    dependencies: ISpaceDataDbPostgresExtensionDependency[]
  ) {
    const operatorClassDependencies = dependencies.filter(
      (dependency) => dependency.objectType === 'operator_class'
    );
    if (!operatorClassDependencies.length) {
      return [];
    }

    const schemaNames = [
      ...new Set(operatorClassDependencies.map((dependency) => dependency.schemaName)),
    ];
    const objectNames = [
      ...new Set(operatorClassDependencies.map((dependency) => dependency.objectName)),
    ];
    const accessMethods = [
      ...new Set(operatorClassDependencies.map((dependency) => dependency.accessMethod)),
    ];
    const rows = normalizeRawRows<{
      schemaName: string;
      objectName: string;
      accessMethod: string;
    }>(
      await client.raw(
        `
          SELECT
            n.nspname AS "schemaName",
            opc.opcname AS "objectName",
            am.amname AS "accessMethod"
          FROM pg_opclass opc
          JOIN pg_namespace n ON n.oid = opc.opcnamespace
          JOIN pg_am am ON am.oid = opc.opcmethod
          WHERE (n.nspname = ANY(?::text[]) OR n.nspname = ANY(current_schemas(true)))
            AND opc.opcname = ANY(?::text[])
            AND am.amname = ANY(?::text[])
        `,
        [schemaNames, objectNames, accessMethods]
      )
    );
    const available = new Set(
      rows.map((row) => [row.schemaName, row.objectName, row.accessMethod].join(':'))
    );
    const visible = new Set(rows.map((row) => [row.objectName, row.accessMethod].join(':')));

    return operatorClassDependencies.filter(
      (dependency) =>
        !available.has(
          [dependency.schemaName, dependency.objectName, dependency.accessMethod].join(':')
        ) && !visible.has([dependency.objectName, dependency.accessMethod].join(':'))
    );
  }

  private async inspectTargetConflicts(
    client: IDataDbPreflightClient,
    internalSchema: string,
    inventory: ISpaceDataDbInventory
  ): Promise<ITargetConflict[]> {
    const conflicts: ITargetConflict[] = [];
    const spaceIds = this.getInventoryCopySpaceIds(inventory);

    if (inventory.baseIds.length) {
      const baseSchemaRows = normalizeRawRows<{ schemaName: string }>(
        await client.raw(
          `
            SELECT schema_name AS "schemaName"
            FROM information_schema.schemata
            WHERE schema_name = ANY(?::text[])
          `,
          [inventory.baseIds]
        )
      );
      conflicts.push(...baseSchemaRows.map((row) => ({ object: `schema:${row.schemaName}` })));
    }

    await this.pushConflictCount(
      client,
      conflicts,
      internalSchema,
      sharedTables.recordHistory,
      inventory.sharedTableIds.length ? `"table_id" = ANY(?::text[])` : '',
      [inventory.sharedTableIds]
    );
    await this.pushConflictCount(
      client,
      conflicts,
      internalSchema,
      sharedTables.tableTrash,
      inventory.sharedTableIds.length ? `"table_id" = ANY(?::text[])` : '',
      [inventory.sharedTableIds]
    );
    await this.pushConflictCount(
      client,
      conflicts,
      internalSchema,
      sharedTables.recordTrash,
      inventory.sharedTableIds.length ? `"table_id" = ANY(?::text[])` : '',
      [inventory.sharedTableIds]
    );
    await this.pushConflictCount(
      client,
      conflicts,
      internalSchema,
      sharedTables.computedUpdateOutbox,
      inventory.baseIds.length ? `"base_id" = ANY(?::text[])` : '',
      [inventory.baseIds]
    );
    await this.pushConflictCount(
      client,
      conflicts,
      internalSchema,
      sharedTables.computedUpdateDeadLetter,
      inventory.baseIds.length ? `"base_id" = ANY(?::text[])` : '',
      [inventory.baseIds]
    );
    await this.pushConflictCount(
      client,
      conflicts,
      internalSchema,
      sharedTables.computedUpdateOutboxSeed,
      inventory.tableIds.length ? `"table_id" = ANY(?::text[])` : '',
      [inventory.tableIds]
    );
    await this.pushConflictCount(
      client,
      conflicts,
      internalSchema,
      sharedTables.computedUpdatePauseScope,
      [
        `("scope_type" = 'space' AND "scope_id" = ANY(?::text[]))`,
        inventory.baseIds.length ? `("scope_type" = 'base' AND "scope_id" = ANY(?::text[]))` : '',
        inventory.sharedTableIds.length
          ? `("scope_type" = 'table' AND "scope_id" = ANY(?::text[]))`
          : '',
      ]
        .filter(Boolean)
        .join(' OR '),
      [spaceIds, inventory.baseIds, inventory.sharedTableIds].filter((value) =>
        Array.isArray(value) ? value.length > 0 : Boolean(value)
      )
    );
    await this.pushConflictCount(
      client,
      conflicts,
      internalSchema,
      sharedTables.undoLog,
      inventory.baseIds.length ? `split_part("table_name", '.', 1) = ANY(?::text[])` : '',
      [inventory.baseIds]
    );

    return conflicts;
  }

  private async pushConflictCount(
    client: IDataDbPreflightClient,
    conflicts: ITargetConflict[],
    internalSchema: string,
    table: string,
    whereSql: string,
    bindings: unknown[]
  ) {
    if (!whereSql) {
      return;
    }

    const qualifiedTable = qualify(internalSchema, table);
    const existsRows = normalizeRawRows<{ exists: boolean }>(
      await client.raw(`SELECT to_regclass(?::text) IS NOT NULL AS "exists"`, [qualifiedTable])
    );
    if (!existsRows[0]?.exists) {
      return;
    }

    const countRows = normalizeRawRows<{ count: string | number | bigint }>(
      await client.raw(
        `SELECT COUNT(*) AS "count" FROM ${qualifiedTable} WHERE ${whereSql}`,
        bindings
      )
    );
    const count = Number(countRows[0]?.count ?? 0);
    if (count > 0) {
      conflicts.push({ object: `table:${internalSchema}.${table}`, count });
    }
  }

  async cleanupTargetArtifactsForJob(
    jobId: string,
    reason: string = 'manual_cleanup',
    options: { truncateSharedTables?: boolean } = {}
  ): Promise<ITargetArtifactCleanupStats> {
    const job = await this.migrationJobClient.spaceDataDbMigrationJob.findUnique({
      where: { id: jobId },
      include: { targetConnection: true },
    });
    if (!job) {
      throw new CustomHttpException(`Migration job ${jobId} not found`, HttpErrorCode.NOT_FOUND);
    }
    if (!job.targetConnection?.encryptedUrl) {
      throw new CustomHttpException(
        `Migration job ${jobId} has no target connection`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    if (job.state === 'succeeded' && job.switchOnCompletion === true) {
      throw new CustomHttpException(
        `Migration job ${jobId} has already switched; automatic target cleanup is unsafe`,
        HttpErrorCode.CONFLICT
      );
    }

    const inventory = this.normalizeInventory(job.inventory, job.spaceId);
    const targetUrl = decryptDataDbUrl(job.targetConnection.encryptedUrl);
    const client = this.clientFactory(targetUrl);
    const stats: ITargetArtifactCleanupStats = {
      reason,
      baseSchemas: [],
      sharedTables: [],
      truncateSharedTables: options.truncateSharedTables === true,
      startedAt: new Date().toISOString(),
    };

    try {
      stats.sharedTables = await this.cleanupTargetSharedRows(
        client,
        job.targetInternalSchema,
        inventory,
        job.spaceId,
        { truncate: options.truncateSharedTables === true }
      );
      stats.baseSchemas = await this.cleanupTargetBaseSchemas(client, inventory.baseIds);
      stats.completedAt = new Date().toISOString();
      await this.updateTargetCleanupStats(jobId, job.copyStats, stats);
      return stats;
    } catch (error) {
      stats.failedAt = new Date().toISOString();
      stats.error = error instanceof Error ? error.message : String(error);
      await this.updateTargetCleanupStats(jobId, job.copyStats, stats).catch(() => undefined);
      if (error instanceof CustomHttpException) {
        throw error;
      }
      throw new CustomHttpException(
        'Target BYODB retry artifact cleanup failed before migration could be queued',
        HttpErrorCode.CONFLICT,
        {
          errorCode: spaceDataDbTargetCleanupFailedErrorCode,
          jobId,
          reason,
          spaceId: job.spaceId,
          internalSchema: job.targetInternalSchema,
          targetError: this.sanitizeTargetErrorMessage(error, targetUrl),
          cleanup: stats,
        }
      );
    } finally {
      await client.destroy().catch(() => undefined);
    }
  }

  private async cleanupTargetBaseSchemas(
    client: IDataDbPreflightClient,
    baseIds: string[]
  ): Promise<ITargetArtifactCleanupStats['baseSchemas']> {
    if (!baseIds.length) {
      return [];
    }

    const rows = normalizeRawRows<{ schemaName: string }>(
      await client.raw(
        `
          SELECT schema_name AS "schemaName"
          FROM information_schema.schemata
          WHERE schema_name = ANY(?::text[])
          ORDER BY schema_name ASC
        `,
        [baseIds]
      )
    );
    const existing = new Set(rows.map((row) => row.schemaName));
    const stats: ITargetArtifactCleanupStats['baseSchemas'] = [];

    for (const schemaName of [...baseIds].sort()) {
      if (existing.has(schemaName)) {
        await client.raw(`DROP SCHEMA IF EXISTS ${quoteIdent(schemaName)} CASCADE`);
      }
      stats.push({
        schemaName,
        dropped: existing.has(schemaName),
      });
    }

    return stats;
  }

  private async cleanupTargetSharedRows(
    client: IDataDbPreflightClient,
    targetSchema: string,
    inventory: ISpaceDataDbInventory,
    spaceId: string,
    options: { truncate?: boolean } = {}
  ): Promise<ITargetArtifactCleanupStats['sharedTables']> {
    const plans = this.buildSharedTableCleanupPlans(inventory, spaceId);
    const stats: ITargetArtifactCleanupStats['sharedTables'] = [];
    const existingPlans: typeof plans = [];

    for (const plan of plans) {
      const qualifiedTable = qualify(targetSchema, plan.table);
      const existsRows = normalizeRawRows<{ exists: boolean }>(
        await client.raw(`SELECT to_regclass(?::text) IS NOT NULL AS "exists"`, [qualifiedTable])
      );
      if (!existsRows[0]?.exists) {
        stats.push({ table: plan.table, deletedRows: null });
        continue;
      }

      if (options.truncate) {
        existingPlans.push(plan);
        continue;
      }

      const deletedRows = normalizeRawRows<{ count: string | number | bigint }>(
        await client.raw(
          `
            WITH deleted AS (
              DELETE FROM ${qualifiedTable}
              WHERE ${plan.whereSql(targetSchema)}
              RETURNING 1
            )
            SELECT COUNT(*) AS "count" FROM deleted
          `,
          plan.bindings
        )
      );
      stats.push({
        table: plan.table,
        deletedRows: Number(deletedRows[0]?.count ?? 0),
      });
    }

    if (options.truncate && existingPlans.length) {
      await client.raw(
        `TRUNCATE TABLE ${existingPlans.map((plan) => qualify(targetSchema, plan.table)).join(', ')}`
      );
      stats.push(
        ...existingPlans.map((plan) => ({
          table: plan.table,
          deletedRows: null,
          truncated: true,
        }))
      );
    }

    return stats;
  }

  private buildSharedTableCleanupPlans(inventory: ISpaceDataDbInventory, spaceId: string) {
    const plans = this.buildSharedTableCountPlans(inventory, spaceId);
    const priority = new Map<string, number>([
      [sharedTables.computedUpdateOutboxSeed, 0],
      [sharedTables.recordHistory, 1],
      [sharedTables.tableTrash, 2],
      [sharedTables.recordTrash, 3],
      [sharedTables.computedUpdateDeadLetter, 4],
      [sharedTables.computedUpdateOutbox, 5],
      [sharedTables.computedUpdatePauseScope, 6],
      [sharedTables.undoLog, 7],
    ]);
    return [...plans].sort((left, right) => {
      const leftPriority = priority.get(left.table) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority = priority.get(right.table) ?? Number.MAX_SAFE_INTEGER;
      return leftPriority - rightPriority || left.table.localeCompare(right.table);
    });
  }

  private async updateTargetCleanupStats(
    jobId: string,
    copyStats: unknown,
    cleanup: ITargetArtifactCleanupStats
  ) {
    const current = this.asRecord(copyStats) ?? {};
    await this.migrationJobClient.spaceDataDbMigrationJob.update({
      where: { id: jobId },
      data: {
        copyStats: {
          ...current,
          targetCleanup: cleanup,
        },
      },
    });
  }

  private async getMigrationJob(jobId: string): Promise<IMigrationJobRecord> {
    const job = await this.migrationJobClient.spaceDataDbMigrationJob.findUnique({
      where: { id: jobId },
      include: { targetConnection: true },
    });
    if (!job) {
      throw new CustomHttpException(`Migration job ${jobId} not found`, HttpErrorCode.NOT_FOUND);
    }
    return job;
  }

  private async validateCopiedData(input: {
    sourceClient: IDataDbPreflightClient;
    targetClient: IDataDbPreflightClient;
    sourceSchema: string;
    targetSchema: string;
    targetConnectionId: string | null;
    targetEncryptedUrl: string;
    inventory: ISpaceDataDbInventory;
    spaceId: string;
  }): Promise<{
    targetSchemaVersion: { latest: string | null; exists: boolean };
    routeSmoke: IRouteSmokeStats;
    baseSchemas: IRowCountValidation[];
    sharedTables: IRowCountValidation[];
    undoFunction: { exists: boolean };
    mismatches: IValidationMismatch[];
  }> {
    const targetSchemaVersion = await this.validateTargetSchemaVersion(
      input.targetClient,
      input.targetSchema
    );
    const routeSmoke = await this.validateRouteSmoke({
      spaceId: input.spaceId,
      targetConnectionId: input.targetConnectionId,
      targetEncryptedUrl: input.targetEncryptedUrl,
      targetSchema: input.targetSchema,
    });
    const baseValidation = await this.validateBaseSchemaRows(
      input.sourceClient,
      input.targetClient,
      input.inventory
    );
    const sharedValidation = await this.validateSharedTableRows(input);
    const undoFunction = await this.validateUndoFunction(input.targetClient, input.targetSchema);
    const mismatches = [
      ...baseValidation.mismatches,
      ...sharedValidation.mismatches,
      ...(targetSchemaVersion.exists
        ? []
        : [
            {
              object: `schema:${input.targetSchema}.${dataDbMigrationTable}`,
              reason: 'target_schema_version_mismatch',
            },
          ]),
      ...(routeSmoke.ok
        ? []
        : [
            {
              object: `route:${input.spaceId}`,
              reason: 'target_route_smoke_failed',
            },
          ]),
      ...(undoFunction.exists
        ? []
        : [
            {
              object: `function:${input.targetSchema}.__teable_capture_undo_row`,
              reason: 'missing_target_function',
            },
          ]),
    ];

    return {
      targetSchemaVersion,
      routeSmoke,
      baseSchemas: baseValidation.validatedRows,
      sharedTables: sharedValidation.validatedRows,
      undoFunction,
      mismatches,
    };
  }

  private async validateBaseSchemaRows(
    sourceClient: IDataDbPreflightClient,
    targetClient: IDataDbPreflightClient,
    inventory: ISpaceDataDbInventory
  ): Promise<{ validatedRows: IRowCountValidation[]; mismatches: IValidationMismatch[] }> {
    const baseIds = inventory.baseIds;
    if (!baseIds.length) {
      return { validatedRows: [], mismatches: [] };
    }

    const [sourceRelations, targetRelations] = await Promise.all([
      this.inspectPhysicalSchemasWithClient(sourceClient, baseIds),
      this.inspectPhysicalSchemasWithClient(targetClient, baseIds),
    ]);
    const sourceMap = this.relationMap(sourceRelations);
    const targetMap = this.relationMap(targetRelations);
    // 签名批量取回：每侧 4 条 catalog 查询覆盖全部 relation，替代逐表往返
    // （大空间数千次串行 catalog 查询是校验耗时的主因）。
    const [sourceSignatures, targetSignatures] = await Promise.all([
      this.inspectRelationSignatures(sourceClient, baseIds),
      this.inspectRelationSignatures(targetClient, baseIds),
    ]);
    const mismatches: IValidationMismatch[] = [];
    const validatedRows: IRowCountValidation[] = [];
    const contentHashEnabled = !readDisabledFlagEnv('BYODB_SPACE_DATA_DB_VALIDATION_CONTENT_HASH');
    const rowValidationPlans: IBaseRelationRowValidationPlan[] = [];

    for (const [key, sourceRelation] of sourceMap) {
      const evaluated = this.evaluateBaseRelationPair({
        key,
        sourceRelation,
        targetRelation: targetMap.get(key),
        sourceSignatures,
        targetSignatures,
        contentHashEnabled,
      });
      mismatches.push(...evaluated.mismatches);
      if (evaluated.rowValidationPlan) {
        rowValidationPlans.push(evaluated.rowValidationPlan);
      }
    }

    const concurrency = readPositiveIntEnv(
      'BYODB_SPACE_DATA_DB_VALIDATION_CONCURRENCY',
      defaultValidationConcurrency
    );
    const rowValidations = await mapWithConcurrency(rowValidationPlans, concurrency, (plan) =>
      this.buildBaseRelationRowValidation(
        sourceClient,
        targetClient,
        plan.key,
        plan.sourceRelation,
        plan.targetRelation,
        { contentHashColumns: plan.contentHashColumns }
      )
    );
    for (const rowValidation of rowValidations) {
      validatedRows.push(rowValidation.validatedRow);
      if (rowValidation.mismatch) {
        mismatches.push(rowValidation.mismatch);
      }
    }

    for (const [key, targetRelation] of targetMap) {
      if (!sourceMap.has(key)) {
        mismatches.push({
          object: `base:${key}`,
          reason: 'extra_target_relation',
          targetKind: targetRelation.relationKind,
        });
      }
    }

    return { validatedRows, mismatches };
  }

  private evaluateBaseRelationPair(input: {
    key: string;
    sourceRelation: ISpaceDataDbPhysicalRelation;
    targetRelation: ISpaceDataDbPhysicalRelation | undefined;
    sourceSignatures: IRelationSignatureMaps;
    targetSignatures: IRelationSignatureMaps;
    contentHashEnabled: boolean;
  }): { mismatches: IValidationMismatch[]; rowValidationPlan?: IBaseRelationRowValidationPlan } {
    const { key, sourceRelation, targetRelation, sourceSignatures, targetSignatures } = input;
    const relationMismatch = this.buildBaseRelationMismatch(key, sourceRelation, targetRelation);
    if (relationMismatch || !targetRelation) {
      return { mismatches: relationMismatch ? [relationMismatch] : [] };
    }

    const mismatches: IValidationMismatch[] = [];
    const columnMismatch = this.buildColumnSignatureMismatch(
      key,
      sourceRelation,
      sourceSignatures,
      targetSignatures
    );
    if (columnMismatch) {
      mismatches.push(columnMismatch);
    }
    mismatches.push(
      ...this.buildRelationDependencySignatureMismatches(
        key,
        sourceRelation,
        sourceSignatures,
        targetSignatures
      )
    );
    if (!relationKindsWithRows.has(sourceRelation.relationKind)) {
      return { mismatches };
    }

    const sourceColumns = sourceSignatures.columns.get(key);
    return {
      mismatches,
      rowValidationPlan: {
        key,
        sourceRelation,
        targetRelation,
        // 列签名一致才做内容哈希：哈希表达式按源列清单展开，
        // 列不一致时目标侧查询会直接报列不存在。
        contentHashColumns:
          input.contentHashEnabled && !columnMismatch && sourceColumns?.length
            ? sourceColumns
            : undefined,
      },
    };
  }

  private buildBaseRelationMismatch(
    key: string,
    sourceRelation: ISpaceDataDbPhysicalRelation,
    targetRelation: ISpaceDataDbPhysicalRelation | undefined
  ): IValidationMismatch | null {
    if (!targetRelation) {
      return {
        object: `base:${key}`,
        reason: 'missing_target_relation',
        sourceKind: sourceRelation.relationKind,
        targetKind: null,
      };
    }
    if (targetRelation.relationKind !== sourceRelation.relationKind) {
      return {
        object: `base:${key}`,
        reason: 'relation_kind_mismatch',
        sourceKind: sourceRelation.relationKind,
        targetKind: targetRelation.relationKind,
      };
    }
    return null;
  }

  private buildColumnSignatureMismatch(
    key: string,
    sourceRelation: ISpaceDataDbPhysicalRelation,
    sourceSignatures: IRelationSignatureMaps,
    targetSignatures: IRelationSignatureMaps
  ): IValidationMismatch | null {
    if (!relationKindsWithColumns.has(sourceRelation.relationKind)) {
      return null;
    }

    const sourceColumns = sourceSignatures.columns.get(key) ?? [];
    const targetColumns = targetSignatures.columns.get(key) ?? [];
    return this.isColumnSignatureEqual(sourceColumns, targetColumns)
      ? null
      : {
          object: `base:${key}`,
          reason: 'column_signature_mismatch',
          sourceColumns,
          targetColumns,
        };
  }

  private async buildBaseRelationRowValidation(
    sourceClient: IDataDbPreflightClient,
    targetClient: IDataDbPreflightClient,
    key: string,
    sourceRelation: ISpaceDataDbPhysicalRelation,
    targetRelation: ISpaceDataDbPhysicalRelation,
    options: { contentHashColumns?: IBaseRelationColumnSignature[] } = {}
  ): Promise<{ validatedRow: IRowCountValidation; mismatch: IValidationMismatch | null }> {
    const hashColumns = options.contentHashColumns;
    const [source, target] = await Promise.all([
      this.countAndHashRows(
        sourceClient,
        sourceRelation.schemaName,
        sourceRelation.relationName,
        hashColumns
      ),
      this.countAndHashRows(
        targetClient,
        targetRelation.schemaName,
        targetRelation.relationName,
        hashColumns
      ),
    ]);
    const validatedRow: IRowCountValidation = {
      object: `base:${key}`,
      sourceCount: source.count,
      targetCount: target.count,
      ...(hashColumns?.length
        ? { sourceContentHash: source.contentHash, targetContentHash: target.contentHash }
        : {}),
    };
    if (source.count !== target.count) {
      return { validatedRow, mismatch: { ...validatedRow, reason: 'row_count_mismatch' } };
    }
    if (
      source.contentHash != null &&
      target.contentHash != null &&
      source.contentHash !== target.contentHash
    ) {
      return { validatedRow, mismatch: { ...validatedRow, reason: 'content_hash_mismatch' } };
    }
    return { validatedRow, mismatch: null };
  }

  private buildRelationDependencySignatureMismatches(
    key: string,
    sourceRelation: ISpaceDataDbPhysicalRelation,
    sourceSignatures: IRelationSignatureMaps,
    targetSignatures: IRelationSignatureMaps
  ): IValidationMismatch[] {
    const mismatches: IValidationMismatch[] = [];

    if (relationKindsWithIndexSignatures.has(sourceRelation.relationKind)) {
      const sourceIndexes = sourceSignatures.indexes.get(key) ?? [];
      const targetIndexes = targetSignatures.indexes.get(key) ?? [];
      if (JSON.stringify(sourceIndexes) !== JSON.stringify(targetIndexes)) {
        mismatches.push({
          object: `base:${key}`,
          reason: 'index_signature_mismatch',
          sourceIndexes,
          targetIndexes,
        });
      }
    }

    if (relationKindsWithTableDependencySignatures.has(sourceRelation.relationKind)) {
      const sourceConstraints = sourceSignatures.constraints.get(key) ?? [];
      const targetConstraints = targetSignatures.constraints.get(key) ?? [];
      const sourceTriggers = sourceSignatures.triggers.get(key) ?? [];
      const targetTriggers = targetSignatures.triggers.get(key) ?? [];
      if (JSON.stringify(sourceConstraints) !== JSON.stringify(targetConstraints)) {
        mismatches.push({
          object: `base:${key}`,
          reason: 'constraint_signature_mismatch',
          sourceConstraints,
          targetConstraints,
        });
      }
      if (JSON.stringify(sourceTriggers) !== JSON.stringify(targetTriggers)) {
        mismatches.push({
          object: `base:${key}`,
          reason: 'trigger_signature_mismatch',
          sourceTriggers,
          targetTriggers,
        });
      }
    }

    return mismatches;
  }

  private async validateSharedTableRows(input: {
    sourceClient: IDataDbPreflightClient;
    targetClient: IDataDbPreflightClient;
    sourceSchema: string;
    targetSchema: string;
    inventory: ISpaceDataDbInventory;
    spaceId: string;
  }): Promise<{ validatedRows: IRowCountValidation[]; mismatches: IValidationMismatch[] }> {
    const countPlans = this.buildSharedTableCountPlans(input.inventory, input.spaceId);
    const relatedCountPlans = this.buildRelatedSharedTableCountPlans(
      input.inventory,
      input.spaceId
    );
    const relatedPlanByTable = new Map(relatedCountPlans.map((plan) => [plan.table, plan]));
    // 共享表在源侧是大表上的过滤扫描，控制并发避免压垮源库。
    const results = await mapWithConcurrency(countPlans, 4, async (plan) => {
      const relatedPlan = relatedPlanByTable.get(plan.table) ?? plan;
      const [sourceCount, targetCount] = await Promise.all([
        this.countRows(
          input.sourceClient,
          input.sourceSchema,
          plan.table,
          plan.whereSql(input.sourceSchema),
          plan.bindings
        ),
        this.countRows(
          input.targetClient,
          input.targetSchema,
          plan.table,
          plan.whereSql(input.targetSchema),
          plan.bindings
        ),
      ]);
      const rowValidation = {
        object: `shared:${plan.table}`,
        sourceCount,
        targetCount,
      };
      const mismatches: IValidationMismatch[] = [];
      if (sourceCount !== targetCount) {
        mismatches.push({
          ...rowValidation,
          reason: 'row_count_mismatch',
        });
      }

      const outOfScopeTargetCount = await this.countRows(
        input.targetClient,
        input.targetSchema,
        plan.table,
        `NOT (${relatedPlan.whereSql(input.targetSchema)})`,
        relatedPlan.bindings
      );
      if (outOfScopeTargetCount > 0) {
        mismatches.push({
          object: `shared:${plan.table}`,
          reason: 'out_of_scope_target_rows',
          targetCount: outOfScopeTargetCount,
        });
      }
      return { rowValidation, mismatches };
    });

    return {
      validatedRows: results.map((result) => result.rowValidation),
      mismatches: results.flatMap((result) => result.mismatches),
    };
  }

  private buildSharedTableCountPlans(inventory: ISpaceDataDbInventory, spaceId: string) {
    return this.buildSharedTableCountPlansForScope(
      inventory,
      spaceId,
      this.getInventoryCopySpaceIds(inventory),
      inventory.baseIds,
      inventory.tableIds,
      inventory.sharedTableIds
    );
  }

  private buildRelatedSharedTableCountPlans(inventory: ISpaceDataDbInventory, spaceId: string) {
    if (!inventory.relatedSpaces.spaces.length) {
      return this.buildSharedTableCountPlansForScope(
        inventory,
        spaceId,
        this.getInventorySpaceIds(inventory),
        inventory.baseIds,
        inventory.tableIds,
        inventory.relatedSharedTableIds
      );
    }

    const relatedBaseIds = this.getRelatedSpaceIds(inventory.relatedSpaces).flatMap(
      (relatedSpaceId) =>
        inventory.relatedSpaces.spaces.find((space) => space.spaceId === relatedSpaceId)?.baseIds ??
        []
    );
    const relatedTableIds = this.getRelatedSpaceIds(inventory.relatedSpaces).flatMap(
      (relatedSpaceId) =>
        inventory.relatedSpaces.spaces.find((space) => space.spaceId === relatedSpaceId)
          ?.tableIds ?? []
    );
    return this.buildSharedTableCountPlansForScope(
      inventory,
      spaceId,
      this.getInventorySpaceIds(inventory),
      relatedBaseIds.sort(),
      relatedTableIds.sort(),
      inventory.relatedSharedTableIds
    );
  }

  private buildSharedTableCountPlansForScope(
    inventory: ISpaceDataDbInventory,
    spaceId: string,
    spaceIds: string[],
    baseIds: string[],
    tableIds: string[],
    sharedTableIds: string[] = tableIds
  ) {
    const plans: { table: string; whereSql: (schema: string) => string; bindings: unknown[] }[] =
      [];
    const pushTableScoped = (table: string) => {
      if (sharedTableIds.length) {
        plans.push({
          table,
          whereSql: () => `"table_id" = ANY(?::text[])`,
          bindings: [sharedTableIds],
        });
      }
    };
    const pushBaseScoped = (table: string) => {
      if (baseIds.length) {
        plans.push({
          table,
          whereSql: () => `"base_id" = ANY(?::text[])`,
          bindings: [baseIds],
        });
      }
    };

    pushTableScoped(sharedTables.recordHistory);
    pushTableScoped(sharedTables.tableTrash);
    pushTableScoped(sharedTables.recordTrash);
    pushBaseScoped(sharedTables.computedUpdateOutbox);
    pushBaseScoped(sharedTables.computedUpdateDeadLetter);

    if (tableIds.length && baseIds.length) {
      plans.push({
        table: sharedTables.computedUpdateOutboxSeed,
        whereSql: (schema) =>
          [
            `"table_id" = ANY(?::text[])`,
            `"task_id" IN (SELECT "id" FROM ${qualify(
              schema,
              sharedTables.computedUpdateOutbox
            )} WHERE "base_id" = ANY(?::text[]))`,
          ].join(' AND '),
        bindings: [tableIds, baseIds],
      });
    }

    plans.push({
      table: sharedTables.computedUpdatePauseScope,
      whereSql: () =>
        [
          `("scope_type" = 'space' AND "scope_id" = ANY(?::text[]))`,
          baseIds.length ? `("scope_type" = 'base' AND "scope_id" = ANY(?::text[]))` : '',
          sharedTableIds.length ? `("scope_type" = 'table' AND "scope_id" = ANY(?::text[]))` : '',
        ]
          .filter(Boolean)
          .join(' OR '),
      bindings: [spaceIds, baseIds, sharedTableIds].filter((value) =>
        Array.isArray(value) ? value.length > 0 : Boolean(value)
      ),
    });

    if (baseIds.length) {
      plans.push({
        table: sharedTables.undoLog,
        whereSql: () => `split_part("table_name", '.', 1) = ANY(?::text[])`,
        bindings: [baseIds],
      });
    }

    return plans;
  }

  private async inspectPhysicalSchemasWithClient(
    client: IDataDbPreflightClient,
    baseIds: string[]
  ): Promise<ISpaceDataDbPhysicalRelation[]> {
    if (!baseIds.length) {
      return [];
    }

    return normalizeRawRows<ISpaceDataDbPhysicalRelation>(
      await client.raw(
        `
          SELECT
            n.nspname AS "schemaName",
            c.relname AS "relationName",
            CASE c.relkind
              WHEN 'r' THEN 'table'
              WHEN 'p' THEN 'partitioned_table'
              WHEN 'S' THEN 'sequence'
              WHEN 'v' THEN 'view'
              WHEN 'm' THEN 'materialized_view'
              WHEN 'f' THEN 'foreign_table'
              ELSE c.relkind::text
            END AS "relationKind",
            pg_total_relation_size(c.oid)::text AS "totalBytes",
            CASE
              WHEN c.relkind IN ('r', 'p', 'f') THEN GREATEST(c.reltuples, 0)::bigint::text
              ELSE NULL
            END AS "estimatedRows"
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ANY(?::text[])
            AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
          ORDER BY n.nspname ASC, c.relname ASC
        `,
        [baseIds]
      )
    );
  }

  private relationMap(relations: ISpaceDataDbPhysicalRelation[]) {
    return new Map(relations.map((relation) => [this.relationKey(relation), relation]));
  }

  private relationKey(relation: ISpaceDataDbPhysicalRelation) {
    return `${relation.schemaName}.${relation.relationName}`;
  }

  // 签名内省按 schema 批量取回（每侧共 4 条查询），避免大空间数千次逐表 catalog 往返。
  private async inspectRelationSignatures(
    client: IDataDbPreflightClient,
    schemas: string[]
  ): Promise<IRelationSignatureMaps> {
    const [columnRows, indexRows, constraintRows, triggerRows] = await Promise.all([
      client.raw<IRelationScopedRow<IBaseRelationColumnSignature>>(
        `
          SELECT
            n.nspname AS "schemaName",
            c.relname AS "relationName",
            a.attnum::integer AS "ordinalPosition",
            a.attname AS "columnName",
            format_type(a.atttypid, a.atttypmod) AS "formattedType",
            a.attnotnull AS "notNull",
            pg_get_expr(ad.adbin, ad.adrelid) AS "defaultExpression",
            a.attidentity AS "identity",
            a.attgenerated AS "generated",
            coll.collname AS "collation"
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
          LEFT JOIN pg_collation coll ON coll.oid = a.attcollation
            AND a.attcollation <> 0
          WHERE n.nspname = ANY(?::text[])
            AND c.relkind IN ('r', 'p', 'f', 'v', 'm')
            AND a.attnum > 0
            AND NOT a.attisdropped
          ORDER BY n.nspname ASC, c.relname ASC, a.attnum ASC
        `,
        [schemas]
      ),
      client.raw<IRelationScopedRow<IBaseRelationIndexSignature>>(
        `
          SELECT
            n.nspname AS "schemaName",
            c.relname AS "relationName",
            ic.relname AS "indexName",
            i.indisprimary AS "isPrimary",
            i.indisunique AS "isUnique",
            i.indisvalid AS "isValid",
            pg_get_indexdef(i.indexrelid) AS "definition"
          FROM pg_index i
          JOIN pg_class c ON c.oid = i.indrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_class ic ON ic.oid = i.indexrelid
          WHERE n.nspname = ANY(?::text[])
          ORDER BY n.nspname ASC, c.relname ASC, i.indisprimary DESC, ic.relname ASC
        `,
        [schemas]
      ),
      client.raw<IRelationScopedRow<IBaseRelationConstraintSignature>>(
        `
          SELECT
            n.nspname AS "schemaName",
            c.relname AS "relationName",
            con.conname AS "constraintName",
            con.contype AS "constraintType",
            pg_get_constraintdef(con.oid, true) AS "definition"
          FROM pg_constraint con
          JOIN pg_class c ON c.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_class referenced_rel ON referenced_rel.oid = con.confrelid
          LEFT JOIN pg_namespace referenced_ns ON referenced_ns.oid = referenced_rel.relnamespace
          WHERE n.nspname = ANY(?::text[])
            AND (con.contype <> 'f' OR referenced_ns.nspname = ANY(?::text[]))
            -- PG18+ materializes NOT NULL as pg_constraint rows (contype 'n'); older
            -- majors don't, so cross-version source/target comparison would always
            -- mismatch. NOT NULL-ness is already covered by the column signatures.
            AND con.contype <> 'n'
          ORDER BY n.nspname ASC, c.relname ASC, con.contype ASC, con.conname ASC
        `,
        [schemas, schemas]
      ),
      client.raw<IRelationScopedRow<IBaseRelationTriggerSignature>>(
        `
          SELECT
            n.nspname AS "schemaName",
            c.relname AS "relationName",
            tg.tgname AS "triggerName",
            tg.tgenabled AS "enabled",
            pg_get_triggerdef(tg.oid, true) AS "definition"
          FROM pg_trigger tg
          JOIN pg_class c ON c.oid = tg.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ANY(?::text[])
            AND NOT tg.tgisinternal
          ORDER BY n.nspname ASC, c.relname ASC, tg.tgname ASC
        `,
        [schemas]
      ),
    ]);
    return {
      columns: groupRelationSignatureRows(normalizeRawRows(columnRows)),
      indexes: groupRelationSignatureRows(normalizeRawRows(indexRows)),
      constraints: groupRelationSignatureRows(normalizeRawRows(constraintRows)),
      triggers: groupRelationSignatureRows(
        normalizeRawRows(triggerRows).filter((trigger) => !this.isMigrationDeltaTrigger(trigger))
      ),
    };
  }

  private isColumnSignatureEqual(
    sourceColumns: IBaseRelationColumnSignature[],
    targetColumns: IBaseRelationColumnSignature[]
  ) {
    return (
      JSON.stringify(this.columnSignatureForComparison(sourceColumns)) ===
      JSON.stringify(this.columnSignatureForComparison(targetColumns))
    );
  }

  private columnSignatureForComparison(columns: IBaseRelationColumnSignature[]) {
    return columns.map(({ ordinalPosition: _ordinalPosition, ...column }) => column);
  }

  private async countAndHashRows(
    client: IDataDbPreflightClient,
    schema: string,
    table: string,
    hashColumns?: IBaseRelationColumnSignature[]
  ): Promise<{ count: number; contentHash: string | null }> {
    const hashSelect = hashColumns?.length
      ? `, COALESCE(SUM(('x' || substr(md5(${this.contentHashRowExpression(
          hashColumns
        )}), 1, 16))::bit(64)::bigint), 0)::text AS "contentHash"`
      : '';
    const rows = normalizeRawRows<{ count: string | number | bigint; contentHash?: string | null }>(
      await client.raw(`SELECT COUNT(*) AS "count"${hashSelect} FROM ${qualify(schema, table)}`)
    );
    return {
      count: Number(rows[0]?.count ?? 0),
      contentHash: rows[0]?.contentHash ?? null,
    };
  }

  // 行内容指纹：sum(每行 64 位哈希) 与行序无关（多重集哈希；不用 xor，成对重复行会互相抵消）。
  // 时间类列的 ::text 渲染依赖会话 GUC（TimeZone/DateStyle），改用 extract(epoch ...) 消除两侧差异；
  // 数组类型套不了 epoch，退回 ::text（teable 物理列不使用时间数组）。
  // 每列用 N/V<length>:<value> 编码，避免分隔符或 NULL 哨兵与真实数据混淆。
  // 用 || 操作符拼接而非 concat_ws：宽表列数会撞上函数 100 参数上限（FUNC_MAX_ARGS）。
  private contentHashRowExpression(columns: IBaseRelationColumnSignature[]) {
    const parts = columns.map((column) => {
      const ident = quoteIdent(column.columnName);
      const type = column.formattedType;
      const timeBased =
        !type.endsWith('[]') &&
        (type.startsWith('timestamp') ||
          type.startsWith('time') ||
          type.startsWith('interval') ||
          type === 'date');
      const rendered = timeBased ? `extract(epoch from ${ident})::text` : `${ident}::text`;
      return [
        `(CASE WHEN ${rendered} IS NULL`,
        "THEN 'N'",
        `ELSE 'V' || length(${rendered})::text || ':' || ${rendered} END)`,
      ].join(' ');
    });
    return parts.join(' || ');
  }

  private async inspectRelationTriggerSignature(
    client: IDataDbPreflightClient,
    schema: string,
    relation: string
  ): Promise<IBaseRelationTriggerSignature[]> {
    return normalizeRawRows<IBaseRelationTriggerSignature>(
      await client.raw(
        `
          SELECT
            tg.tgname AS "triggerName",
            tg.tgenabled AS "enabled",
            pg_get_triggerdef(tg.oid, true) AS "definition"
          FROM pg_trigger tg
          JOIN pg_class c ON c.oid = tg.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ?
            AND c.relname = ?
            AND NOT tg.tgisinternal
          ORDER BY tg.tgname ASC
        `,
        [schema, relation]
      )
    ).filter((trigger) => !this.isMigrationDeltaTrigger(trigger));
  }

  private async countRows(
    client: IDataDbPreflightClient,
    schema: string,
    table: string,
    whereSql?: string,
    bindings: unknown[] = []
  ) {
    const rows = normalizeRawRows<{ count: string | number | bigint }>(
      await client.raw(
        `SELECT COUNT(*) AS "count" FROM ${qualify(schema, table)}${
          whereSql ? ` WHERE ${whereSql}` : ''
        }`,
        bindings
      )
    );
    return Number(rows[0]?.count ?? 0);
  }

  private async inspectSourceComputedDrain(
    client: IDataDbPreflightClient,
    schema: string,
    baseIds: string[],
    processingLeaseMs: number
  ): Promise<IComputedDrainStats> {
    const reclaimBefore = new Date(Date.now() - processingLeaseMs);
    const rows = normalizeRawRows<{
      activeCount: string | number | bigint | null;
      reclaimableCount: string | number | bigint | null;
      oldestActiveLockedAt: Date | string | null;
    }>(
      await client.raw(
        `
          SELECT
            COUNT(*) FILTER (
              WHERE "status" = 'processing'
                AND "locked_at" IS NOT NULL
                AND "locked_at" > ?::timestamp
            ) AS "activeCount",
            COUNT(*) FILTER (
              WHERE "status" = 'processing'
                AND ("locked_at" IS NULL OR "locked_at" <= ?::timestamp)
            ) AS "reclaimableCount",
            MIN("locked_at") FILTER (
              WHERE "status" = 'processing'
                AND "locked_at" IS NOT NULL
                AND "locked_at" > ?::timestamp
            ) AS "oldestActiveLockedAt"
          FROM ${qualify(schema, sharedTables.computedUpdateOutbox)}
          WHERE "base_id" = ANY(?::text[])
        `,
        [reclaimBefore, reclaimBefore, reclaimBefore, baseIds]
      )
    );
    const row = rows[0];
    return this.buildComputedDrainStats({
      activeCount: Number(row?.activeCount ?? 0),
      reclaimableCount: Number(row?.reclaimableCount ?? 0),
      oldestActiveLockedAt: row?.oldestActiveLockedAt ?? null,
    });
  }

  private async inspectSchemaOperationDrain(
    inventory: ISpaceDataDbInventory,
    staleBefore: Date
  ): Promise<ISchemaOperationDrainStats> {
    const where = this.buildSchemaOperationWhere(inventory);
    const activeWhere = this.buildActiveNonTerminalWhere(where, staleBefore, [
      { lockedAt: { gte: staleBefore } },
    ]);
    const staleWhere = this.buildStaleNonTerminalWhere(where, staleBefore, [
      { OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }] },
    ]);
    const [openCount, sample, staleIgnoredCount, staleIgnoredSample] = await Promise.all([
      this.prismaService.schemaOperation.count({ where: activeWhere }),
      this.prismaService.schemaOperation.findMany({
        where: activeWhere,
        select: {
          id: true,
          status: true,
          phase: true,
          baseId: true,
          tableId: true,
          lockedAt: true,
          lockedBy: true,
          createdTime: true,
          lastModifiedTime: true,
        },
        orderBy: [{ lastModifiedTime: 'desc' }, { createdTime: 'desc' }],
        take: 10,
      }),
      this.prismaService.schemaOperation.count({ where: staleWhere }),
      this.prismaService.schemaOperation.findMany({
        where: staleWhere,
        select: {
          id: true,
          status: true,
          phase: true,
          baseId: true,
          tableId: true,
          lockedAt: true,
          lockedBy: true,
          createdTime: true,
          lastModifiedTime: true,
        },
        orderBy: [{ lastModifiedTime: 'desc' }, { createdTime: 'desc' }],
        take: 10,
      }),
    ]);

    return this.buildSchemaOperationDrainStats(openCount, sample, {
      staleBefore,
      staleIgnoredCount,
      staleIgnoredSample,
    });
  }

  private buildSchemaOperationWhere(
    inventory: ISpaceDataDbInventory
  ): Prisma.SchemaOperationWhereInput {
    const resourceIds = [...new Set([...inventory.baseIds, ...inventory.tableIds])];
    const scopeFilters: Prisma.SchemaOperationWhereInput[] = [];
    if (inventory.baseIds.length) {
      scopeFilters.push({ baseId: { in: inventory.baseIds } });
    }
    if (inventory.tableIds.length) {
      scopeFilters.push({ tableId: { in: inventory.tableIds } });
    }
    if (resourceIds.length) {
      scopeFilters.push({ resourceId: { in: resourceIds } });
    }

    return {
      status: { in: [...openSchemaOperationStatuses] },
      OR: scopeFilters,
    };
  }

  private buildActiveNonTerminalWhere<T extends object>(
    where: T,
    staleBefore: Date,
    extraActiveFilters: object[] = []
  ): T {
    return {
      AND: [
        where,
        {
          OR: [
            { lastModifiedTime: { gte: staleBefore } },
            { lastModifiedTime: null, createdTime: { gte: staleBefore } },
            ...extraActiveFilters,
          ],
        },
      ],
    } as T;
  }

  private buildStaleNonTerminalWhere<T extends object>(
    where: T,
    staleBefore: Date,
    extraStaleFilters: object[] = []
  ): T {
    return {
      AND: [
        where,
        {
          OR: [
            { lastModifiedTime: { lt: staleBefore } },
            { lastModifiedTime: null, createdTime: { lt: staleBefore } },
          ],
        },
        ...extraStaleFilters,
      ],
    } as T;
  }

  private buildSchemaOperationDrainStats(
    openCount: number,
    sample: {
      id: string;
      status: string;
      phase: string;
      baseId: string | null;
      tableId: string | null;
      lockedAt: Date | string | null;
      lockedBy: string | null;
      createdTime?: Date | string | null;
      lastModifiedTime: Date | string | null;
    }[],
    stale?: {
      staleBefore: Date;
      staleIgnoredCount: number;
      staleIgnoredSample: {
        id: string;
        status: string;
        phase: string;
        baseId: string | null;
        tableId: string | null;
        lockedAt: Date | string | null;
        lockedBy: string | null;
        createdTime?: Date | string | null;
        lastModifiedTime: Date | string | null;
      }[];
    }
  ): ISchemaOperationDrainStats {
    return {
      openCount,
      sample: sample.map((operation) => ({
        id: operation.id,
        status: operation.status,
        phase: operation.phase,
        baseId: operation.baseId,
        tableId: operation.tableId,
        lockedAt: this.toNullableIso(operation.lockedAt),
        lockedBy: operation.lockedBy,
        createdTime: this.toNullableIso(operation.createdTime ?? null),
        lastModifiedTime: this.toNullableIso(operation.lastModifiedTime),
      })),
      ...(stale?.staleIgnoredCount
        ? {
            staleIgnoredCount: stale.staleIgnoredCount,
            staleIgnoredSample: stale.staleIgnoredSample.map((operation) => ({
              id: operation.id,
              status: operation.status,
              phase: operation.phase,
              baseId: operation.baseId,
              tableId: operation.tableId,
              lockedAt: this.toNullableIso(operation.lockedAt),
              lockedBy: operation.lockedBy,
              createdTime: this.toNullableIso(operation.createdTime ?? null),
              lastModifiedTime: this.toNullableIso(operation.lastModifiedTime),
            })),
            staleBefore: stale.staleBefore.toISOString(),
          }
        : {}),
      checkedAt: new Date().toISOString(),
    };
  }

  private async updateSchemaOperationDrainStats(
    job: IMigrationJobRecord,
    inventory: ISpaceDataDbInventory,
    phase: 'schema_operations_draining' | 'schema_operations_drained',
    stats: ISchemaOperationDrainStats
  ) {
    await this.migrationJobClient.spaceDataDbMigrationJob.update({
      where: { id: job.id },
      data: {
        copyStats: {
          phase,
          progress: this.buildMigrationProgress(job, inventory, phase),
          schemaOperations: stats,
        },
        lastError: null,
      },
    });
  }

  private async inspectBackgroundWriterDrain(
    spaceId: string,
    inventory: ISpaceDataDbInventory,
    options: {
      probeTimeoutMs: number;
      queueScanBatchSize: number;
      queueScanLimit: number;
      staleBefore: Date;
    }
  ): Promise<IBackgroundWriterDrainStats> {
    const [provisionResources, queueJobs] = await Promise.all([
      withTimeout(
        this.inspectProvisionResourceDrain(spaceId, inventory, options.staleBefore),
        options.probeTimeoutMs,
        `Timed out inspecting provisioning resources after ${options.probeTimeoutMs}ms`
      ),
      withTimeout(
        this.inspectImportQueueDrain(inventory, options),
        options.probeTimeoutMs,
        `Timed out inspecting import queues after ${options.probeTimeoutMs}ms`
      ),
    ]);
    return this.buildBackgroundWriterDrainStats(provisionResources, queueJobs);
  }

  private async inspectProvisionResourceDrain(
    spaceId: string,
    inventory: ISpaceDataDbInventory,
    staleBefore: Date
  ): Promise<{
    openCount: number;
    sample: IBackgroundWriterDrainSample[];
    staleIgnoredCount: number;
    staleIgnoredSample: IBackgroundWriterDrainSample[];
    staleBefore: string;
  }> {
    const baseWhere = this.buildProvisionBaseWhere(spaceId, inventory);
    const tableWhere = this.buildProvisionTableWhere(inventory);
    const fieldWhere = this.buildProvisionFieldWhere(inventory);
    const activeBaseWhere = this.buildActiveNonTerminalWhere(baseWhere, staleBefore);
    const activeTableWhere = tableWhere
      ? this.buildActiveNonTerminalWhere(tableWhere, staleBefore)
      : null;
    const activeFieldWhere = fieldWhere
      ? this.buildActiveNonTerminalWhere(fieldWhere, staleBefore)
      : null;
    const staleBaseWhere = this.buildStaleNonTerminalWhere(baseWhere, staleBefore);
    const staleTableWhere = tableWhere
      ? this.buildStaleNonTerminalWhere(tableWhere, staleBefore)
      : null;
    const staleFieldWhere = fieldWhere
      ? this.buildStaleNonTerminalWhere(fieldWhere, staleBefore)
      : null;
    const [
      baseCount,
      tableCount,
      fieldCount,
      baseSample,
      tableSample,
      fieldSample,
      staleBaseCount,
      staleTableCount,
      staleFieldCount,
      staleBaseSample,
      staleTableSample,
      staleFieldSample,
    ] = await Promise.all([
      this.prismaService.base.count({ where: activeBaseWhere }),
      activeTableWhere
        ? this.prismaService.tableMeta.count({ where: activeTableWhere })
        : Promise.resolve(0),
      activeFieldWhere
        ? this.prismaService.field.count({ where: activeFieldWhere })
        : Promise.resolve(0),
      this.prismaService.base.findMany({
        where: activeBaseWhere,
        select: {
          id: true,
          provisionState: true,
          createdTime: true,
          lastModifiedTime: true,
        },
        orderBy: [{ lastModifiedTime: 'desc' }, { createdTime: 'desc' }],
        take: 10,
      }),
      activeTableWhere
        ? this.prismaService.tableMeta.findMany({
            where: activeTableWhere,
            select: {
              id: true,
              baseId: true,
              provisionState: true,
              createdTime: true,
              lastModifiedTime: true,
            },
            orderBy: [{ lastModifiedTime: 'desc' }, { createdTime: 'desc' }],
            take: 10,
          })
        : Promise.resolve([]),
      activeFieldWhere
        ? this.prismaService.field.findMany({
            where: activeFieldWhere,
            select: {
              id: true,
              tableId: true,
              provisionState: true,
              createdTime: true,
              lastModifiedTime: true,
            },
            orderBy: [{ lastModifiedTime: 'desc' }, { createdTime: 'desc' }],
            take: 10,
          })
        : Promise.resolve([]),
      this.prismaService.base.count({ where: staleBaseWhere }),
      staleTableWhere
        ? this.prismaService.tableMeta.count({ where: staleTableWhere })
        : Promise.resolve(0),
      staleFieldWhere
        ? this.prismaService.field.count({ where: staleFieldWhere })
        : Promise.resolve(0),
      this.prismaService.base.findMany({
        where: staleBaseWhere,
        select: {
          id: true,
          provisionState: true,
          createdTime: true,
          lastModifiedTime: true,
        },
        orderBy: [{ lastModifiedTime: 'desc' }, { createdTime: 'desc' }],
        take: 10,
      }),
      staleTableWhere
        ? this.prismaService.tableMeta.findMany({
            where: staleTableWhere,
            select: {
              id: true,
              baseId: true,
              provisionState: true,
              createdTime: true,
              lastModifiedTime: true,
            },
            orderBy: [{ lastModifiedTime: 'desc' }, { createdTime: 'desc' }],
            take: 10,
          })
        : Promise.resolve([]),
      staleFieldWhere
        ? this.prismaService.field.findMany({
            where: staleFieldWhere,
            select: {
              id: true,
              tableId: true,
              provisionState: true,
              createdTime: true,
              lastModifiedTime: true,
            },
            orderBy: [{ lastModifiedTime: 'desc' }, { createdTime: 'desc' }],
            take: 10,
          })
        : Promise.resolve([]),
    ]);

    const activeSample = this.buildProvisionDrainSamples(baseSample, tableSample, fieldSample);
    const staleIgnoredSample = this.buildProvisionDrainSamples(
      staleBaseSample,
      staleTableSample,
      staleFieldSample
    );
    return {
      openCount: baseCount + tableCount + fieldCount,
      sample: activeSample,
      staleIgnoredCount: staleBaseCount + staleTableCount + staleFieldCount,
      staleIgnoredSample,
      staleBefore: staleBefore.toISOString(),
    };
  }

  private buildProvisionDrainSamples(
    baseSample: {
      id: string;
      provisionState: string;
      createdTime: Date | string | null;
      lastModifiedTime: Date | string | null;
    }[],
    tableSample: {
      id: string;
      baseId: string;
      provisionState: string;
      createdTime: Date | string | null;
      lastModifiedTime: Date | string | null;
    }[],
    fieldSample: {
      id: string;
      tableId: string;
      provisionState: string;
      createdTime: Date | string | null;
      lastModifiedTime: Date | string | null;
    }[]
  ): IBackgroundWriterDrainSample[] {
    return [
      ...baseSample.map((resource) => ({
        kind: 'provision_resource' as const,
        resourceType: 'base' as const,
        id: resource.id,
        state: resource.provisionState,
        baseId: resource.id,
        tableId: null,
        createdTime: this.toNullableIso(resource.createdTime),
        lastModifiedTime: this.toNullableIso(resource.lastModifiedTime),
      })),
      ...tableSample.map((resource) => ({
        kind: 'provision_resource' as const,
        resourceType: 'table' as const,
        id: resource.id,
        state: resource.provisionState,
        baseId: resource.baseId,
        tableId: resource.id,
        createdTime: this.toNullableIso(resource.createdTime),
        lastModifiedTime: this.toNullableIso(resource.lastModifiedTime),
      })),
      ...fieldSample.map((resource) => ({
        kind: 'provision_resource' as const,
        resourceType: 'field' as const,
        id: resource.id,
        state: resource.provisionState,
        baseId: null,
        tableId: resource.tableId,
        createdTime: this.toNullableIso(resource.createdTime),
        lastModifiedTime: this.toNullableIso(resource.lastModifiedTime),
      })),
    ];
  }

  private buildProvisionBaseWhere(
    spaceId: string,
    inventory: ISpaceDataDbInventory
  ): Prisma.BaseWhereInput {
    return {
      deletedTime: null,
      provisionState: { in: [...blockingProvisionStates] },
      OR: [{ spaceId }, ...(inventory.baseIds.length ? [{ id: { in: inventory.baseIds } }] : [])],
    };
  }

  private buildProvisionTableWhere(
    inventory: ISpaceDataDbInventory
  ): Prisma.TableMetaWhereInput | null {
    const filters: Prisma.TableMetaWhereInput[] = [];
    if (inventory.baseIds.length) {
      filters.push({ baseId: { in: inventory.baseIds } });
    }
    if (inventory.tableIds.length) {
      filters.push({ id: { in: inventory.tableIds } });
    }
    if (!filters.length) {
      return null;
    }
    return {
      deletedTime: null,
      provisionState: { in: [...blockingProvisionStates] },
      OR: filters,
    };
  }

  private buildProvisionFieldWhere(
    inventory: ISpaceDataDbInventory
  ): Prisma.FieldWhereInput | null {
    if (!inventory.tableIds.length) {
      return null;
    }
    return {
      tableId: { in: inventory.tableIds },
      deletedTime: null,
      provisionState: { in: [...blockingProvisionStates] },
    };
  }

  private async inspectImportQueueDrain(
    inventory: ISpaceDataDbInventory,
    options: { queueScanBatchSize: number; queueScanLimit: number }
  ): Promise<{ openCount: number; sample: IBackgroundWriterDrainStats['sample'] }> {
    const queues = [
      { name: BASE_IMPORT_CSV_QUEUE, queue: this.baseImportCsvQueue },
      { name: BASE_IMPORT_JUNCTION_CSV_QUEUE, queue: this.baseImportJunctionCsvQueue },
      { name: TABLE_IMPORT_CSV_CHUNK_QUEUE, queue: this.tableImportCsvChunkQueue },
      { name: TABLE_IMPORT_CSV_QUEUE, queue: this.tableImportCsvQueue },
    ];
    const samples: IBackgroundWriterDrainStats['sample'] = [];
    let openCount = 0;

    for (const { name, queue } of queues) {
      if (!queue) {
        continue;
      }
      const jobs = await this.getOpenQueueJobs(queue, options);
      for (const job of jobs) {
        const sample = await this.buildQueueJobDrainSample(name, job, inventory);
        if (sample) {
          openCount++;
          samples.push(sample);
        }
      }
    }

    return { openCount, sample: samples };
  }

  private async getOpenQueueJobs(
    queue: Queue<unknown>,
    options: { queueScanBatchSize: number; queueScanLimit: number }
  ) {
    const openJobs = [];
    const batchSize = Math.max(1, options.queueScanBatchSize);
    const scanLimit = Math.max(1, options.queueScanLimit);
    let start = 0;

    while (start < scanLimit) {
      const end = Math.min(start + batchSize - 1, scanLimit - 1);
      const jobs = await queue.getJobs([...openQueueJobStates] as never, start, end, false);
      if (!jobs.length) {
        break;
      }

      for (const job of jobs) {
        const state = await this.getQueueJobState(job);
        if (this.isOpenQueueJobState(state)) {
          openJobs.push(job);
        }
      }

      if (jobs.length < batchSize) {
        break;
      }
      start += batchSize;
    }

    return openJobs;
  }

  private async buildQueueJobDrainSample(
    queueName: string,
    job: {
      id?: string | number;
      name?: string;
      data?: unknown;
      timestamp?: number;
      getState?: () => Promise<string>;
    },
    inventory: ISpaceDataDbInventory
  ): Promise<IBackgroundWriterDrainStats['sample'][number] | null> {
    const data = this.asRecord(job.data);
    if (!data) {
      return null;
    }
    const scope = this.getQueueJobScope(data);
    if (!this.queueJobTouchesInventory(scope, inventory)) {
      return null;
    }
    const state = await this.getQueueJobState(job);
    return {
      kind: 'queue_job',
      queueName,
      id: String(job.id ?? job.name ?? 'unknown'),
      state,
      baseId: scope.baseId,
      tableId: scope.tableId,
      timestamp:
        typeof job.timestamp === 'number' ? this.toNullableIso(new Date(job.timestamp)) : null,
    };
  }

  private getQueueJobScope(data: Record<string, unknown>) {
    const table = this.asRecord(data.table);
    const tableIdMap = this.asRecord(data.tableIdMap);
    const tableIdMapValues = tableIdMap
      ? Object.values(tableIdMap).filter((value): value is string => typeof value === 'string')
      : [];
    return {
      baseId: typeof data.baseId === 'string' ? data.baseId : null,
      tableId:
        (table && typeof table.id === 'string' ? table.id : null) ??
        (typeof data.tableId === 'string' ? data.tableId : null) ??
        (tableIdMapValues.length === 1 ? tableIdMapValues[0] : null),
      tableIds: tableIdMapValues,
    };
  }

  private queueJobTouchesInventory(
    scope: { baseId: string | null; tableId: string | null; tableIds: string[] },
    inventory: ISpaceDataDbInventory
  ) {
    const baseIds = new Set(inventory.baseIds);
    const tableIds = new Set(inventory.tableIds);
    return (
      (scope.baseId != null && baseIds.has(scope.baseId)) ||
      (scope.tableId != null && tableIds.has(scope.tableId)) ||
      scope.tableIds.some((tableId) => tableIds.has(tableId))
    );
  }

  private async getQueueJobState(job: { state?: string; getState?: () => Promise<string> }) {
    if (typeof job.getState === 'function') {
      return await job.getState();
    }
    return job.state ?? 'unknown';
  }

  private isOpenQueueJobState(state: string) {
    return (openQueueJobStates as readonly string[]).includes(state);
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private toNullableNumber(value: unknown): number | null {
    if (value == null) {
      return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  private buildBackgroundWriterDrainStats(
    provisionResources: {
      openCount: number;
      sample: IBackgroundWriterDrainSample[];
      staleIgnoredCount?: number;
      staleIgnoredSample?: IBackgroundWriterDrainSample[];
      staleBefore?: string;
    },
    queueJobs: { openCount: number; sample: IBackgroundWriterDrainSample[] }
  ): IBackgroundWriterDrainStats {
    return {
      openCount: provisionResources.openCount + queueJobs.openCount,
      provisionResourceCount: provisionResources.openCount,
      queueJobCount: queueJobs.openCount,
      sample: [...provisionResources.sample, ...queueJobs.sample].slice(0, 10),
      ...(provisionResources.staleIgnoredCount
        ? {
            staleIgnoredCount: provisionResources.staleIgnoredCount,
            staleIgnoredSample: provisionResources.staleIgnoredSample?.slice(0, 10) ?? [],
            staleBefore: provisionResources.staleBefore,
          }
        : {}),
      checkedAt: new Date().toISOString(),
    };
  }

  private async updateBackgroundWriterDrainStats(
    job: IMigrationJobRecord,
    inventory: ISpaceDataDbInventory,
    phase: 'background_writers_draining' | 'background_writers_drained',
    stats: IBackgroundWriterDrainStats
  ) {
    await this.migrationJobClient.spaceDataDbMigrationJob.update({
      where: { id: job.id },
      data: {
        copyStats: {
          phase,
          progress: this.buildMigrationProgress(job, inventory, phase),
          backgroundWriters: stats,
        },
        lastError: null,
      },
    });
  }

  private buildComputedDrainStats(input: {
    activeCount: number;
    reclaimableCount: number;
    oldestActiveLockedAt: Date | string | null;
  }): IComputedDrainStats {
    return {
      activeCount: input.activeCount,
      reclaimableCount: input.reclaimableCount,
      oldestActiveLockedAt: this.toNullableIso(input.oldestActiveLockedAt),
      checkedAt: new Date().toISOString(),
    };
  }

  private async updateComputedDrainStats(
    job: IMigrationJobRecord,
    inventory: ISpaceDataDbInventory,
    phase: 'computed_draining' | 'computed_drained',
    stats: IComputedDrainStats
  ) {
    await this.migrationJobClient.spaceDataDbMigrationJob.update({
      where: { id: job.id },
      data: {
        copyStats: {
          phase,
          progress: this.buildMigrationProgress(job, inventory, phase),
          computedDrain: stats,
        },
        lastError: null,
      },
    });
  }

  private toNullableIso(value: Date | string | null): string | null {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }

  private async validateUndoFunction(client: IDataDbPreflightClient, targetSchema: string) {
    const rows = normalizeRawRows<{ exists: boolean }>(
      await client.raw(`SELECT to_regprocedure(?::text) IS NOT NULL AS "exists"`, [
        `${targetSchema}.__teable_capture_undo_row()`,
      ])
    );
    return { exists: Boolean(rows[0]?.exists) };
  }

  private async validateTargetSchemaVersion(client: IDataDbPreflightClient, targetSchema: string) {
    const latest = this.baselineService.getLatestSchemaVersion();
    if (!latest) {
      return { latest, exists: true };
    }

    const rows = normalizeRawRows<{ exists: boolean }>(
      await client.raw(
        `
          SELECT EXISTS (
            SELECT 1
            FROM ${qualify(targetSchema, dataDbMigrationTable)}
            WHERE "id" = ?
          ) AS "exists"
        `,
        [latest]
      )
    );
    return { latest, exists: Boolean(rows[0]?.exists) };
  }

  private async validateRouteSmoke(input: {
    spaceId: string;
    targetConnectionId: string | null;
    targetEncryptedUrl: string;
    targetSchema: string;
  }): Promise<IRouteSmokeStats> {
    if (!input.targetConnectionId) {
      return {
        ok: false,
        connectionId: null,
        internalSchema: null,
        cacheKey: null,
        isMetaFallback: true,
        error: 'Migration job has no target connection id',
      };
    }

    try {
      const resolved = await this.dataDbClientManager.getDataDatabaseForSpace(input.spaceId, {
        previewBinding: {
          spaceId: input.spaceId,
          connectionId: input.targetConnectionId,
          encryptedUrl: input.targetEncryptedUrl,
          internalSchema: input.targetSchema,
        },
      });
      const connectionId = resolved.connectionId ?? null;
      const internalSchema = resolved.internalSchema ?? null;
      const ok =
        !resolved.isMetaFallback &&
        connectionId === input.targetConnectionId &&
        internalSchema === input.targetSchema &&
        resolved.cacheKey === input.targetConnectionId;

      return {
        ok,
        connectionId,
        internalSchema,
        cacheKey: resolved.cacheKey,
        isMetaFallback: resolved.isMetaFallback,
      };
    } catch (error) {
      return {
        ok: false,
        connectionId: null,
        internalSchema: null,
        cacheKey: null,
        isMetaFallback: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async deleteMigrationComputedPause(
    client: IDataDbPreflightClient,
    schema: string,
    spaceIds: string[],
    jobId: string
  ) {
    const rows = normalizeRawRows<{ id: string }>(
      await client.raw(
        `
          DELETE FROM ${qualify(schema, sharedTables.computedUpdatePauseScope)}
          WHERE "scope_type" = ?
            AND "scope_id" = ANY(?::text[])
            AND "reason" = ?
          RETURNING "id"
        `,
        ['space', spaceIds, migrationPauseReason(jobId)]
      )
    );
    return { deleted: rows.length };
  }

  private get migrationJobClient(): IMigrationJobClient {
    return this.prismaService as unknown as IMigrationJobClient;
  }
}
