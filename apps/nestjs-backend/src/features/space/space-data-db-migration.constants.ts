/* eslint-disable @typescript-eslint/naming-convention */
export const migrateSpaceTargetMode = 'migrate-space';
export const spaceDataDbAdminOnlyErrorCode = 'SPACE_DATA_DB_ADMIN_ONLY';
export const spaceDataDbAdminOnlyMessage =
  'Space data database migration is only available from the admin panel';

export const activeSpaceDataDbMigrationStates = [
  'pending',
  'waiting_worker',
  'preflight',
  'freezing_writes',
  'copying',
  'validating',
  'switching',
] as const;

export const preCopyCancelableSpaceDataDbMigrationStates = [
  'pending',
  'waiting_worker',
  'preflight',
  'freezing_writes',
] as const;
export const cancelableSpaceDataDbMigrationStates = [
  ...preCopyCancelableSpaceDataDbMigrationStates,
  'copying',
] as const;

export const spaceDataDbMigratingErrorCode = 'SPACE_DATA_DB_MIGRATING';
export const spaceDataDbMigrationActiveErrorCode = 'SPACE_DATA_DB_MIGRATION_ACTIVE';
export const spaceDataDbMigrationCanceledErrorCode = 'SPACE_DATA_DB_MIGRATION_CANCELED';
export const spaceDataDbMigrationCancelConflictErrorCode =
  'SPACE_DATA_DB_MIGRATION_CANCEL_CONFLICT';
export const spaceDataDbTargetConflictErrorCode = 'SPACE_DATA_DB_TARGET_CONFLICT';
export const spaceDataDbTargetCleanupFailedErrorCode = 'SPACE_DATA_DB_TARGET_CLEANUP_FAILED';
export const spaceDataDbTargetExtensionMissingErrorCode = 'SPACE_DATA_DB_TARGET_EXTENSION_MISSING';
export const spaceDataDbLargeMigrationConfirmationRequiredErrorCode =
  'SPACE_DATA_DB_LARGE_MIGRATION_CONFIRMATION_REQUIRED';
export const spaceDataDbRollbackUnsafeErrorCode = 'SPACE_DATA_DB_ROLLBACK_UNSAFE';
export const spaceDataDbValidationMismatchErrorCode = 'SPACE_DATA_DB_VALIDATION_MISMATCH';
export const spaceDataDbInventoryChangedErrorCode = 'SPACE_DATA_DB_INVENTORY_CHANGED';
export const spaceDataDbRelatedSpacesRequiredErrorCode = 'SPACE_DATA_DB_RELATED_SPACES_REQUIRED';
export const spaceDataDbTempDiskInsufficientErrorCode = 'SPACE_DATA_DB_TEMP_DISK_INSUFFICIENT';
export const spaceDataDbTargetDiskInsufficientErrorCode = 'SPACE_DATA_DB_TARGET_DISK_INSUFFICIENT';
export const spaceDataDbPostgresToolUnavailableErrorCode =
  'SPACE_DATA_DB_POSTGRES_TOOL_UNAVAILABLE';
export const spaceDataDbComputedDrainTimeoutErrorCode = 'SPACE_DATA_DB_COMPUTED_DRAIN_TIMEOUT';
export const spaceDataDbSchemaOperationDrainTimeoutErrorCode =
  'SPACE_DATA_DB_SCHEMA_OPERATION_DRAIN_TIMEOUT';
export const spaceDataDbBackgroundWriterDrainTimeoutErrorCode =
  'SPACE_DATA_DB_BACKGROUND_WRITER_DRAIN_TIMEOUT';
export const spaceDataDbStaleActiveJobErrorCode = 'SPACE_DATA_DB_STALE_ACTIVE_JOB';
