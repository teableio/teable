export type AppBundleErrorCode =
  | 'bundle.invalid_zip'
  | 'bundle.unexpected_file'
  | 'bundle.missing_manifest'
  | 'bundle.invalid_manifest'
  | 'bundle.unsupported_format'
  | 'bundle.missing_structure'
  | 'bundle.invalid_structure'
  | 'bundle.invalid_seed'
  | 'bundle.invalid_migration'
  | 'bundle.seed_table_unknown'
  | 'bundle.seed_field_unknown'
  | 'bundle.checksum_mismatch'
  | 'install.schema_downgrade'
  | 'install.version_conflict'
  | 'install.migration_missing'
  | 'install.dot_tea_parser_missing'
  | 'install.command_failed'
  | 'install.query_failed';

/**
 * Raised when a bundle is malformed or an installation cannot proceed.
 * Bundle problems are caller errors, so the public API rejects with this type
 * instead of returning a `Result`.
 */
export class AppBundleError extends Error {
  constructor(
    readonly code: AppBundleErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'AppBundleError';
  }
}

export const isAppBundleError = (error: unknown): error is AppBundleError =>
  error instanceof AppBundleError;
