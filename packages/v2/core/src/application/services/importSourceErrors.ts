import { domainError, type DomainError } from '../../domain/shared/DomainError';

/** Emitted by record-insert adapters when the source stream ends before its last batch. */
export const RECORD_INSERT_STREAM_SOURCE_INTERRUPTED_CODE =
  'record.insert_many_stream.source_interrupted';

/** Stable import contract for the same failure; carries the observed progress. */
export const IMPORT_SOURCE_INTERRUPTED_CODE = 'import.source_interrupted';

const numericDetail = (details: Readonly<Record<string, unknown>> | undefined, key: string) => {
  const value = details?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

/**
 * Rewrites a record-insert source interruption into the import contract.
 *
 * Import handlers run the insert in one transaction, so the observed rows were
 * rolled back. The message says that explicitly and marks the error retryable;
 * every other error is returned unchanged. Transport text is not copied into
 * `details` because it can contain a presigned URL or token; the source error
 * stays attached non-enumerably for server-side diagnosis.
 */
export const toImportWriteError = (error: DomainError): DomainError => {
  if (error.code !== RECORD_INSERT_STREAM_SOURCE_INTERRUPTED_CODE) return error;
  const insertedRows = numericDetail(error.details, 'insertedRows');
  const insertedBatches = numericDetail(error.details, 'insertedBatches');
  return domainError.infrastructure({
    code: IMPORT_SOURCE_INTERRUPTED_CODE,
    message: `Import source stream was interrupted after ${insertedRows} row(s) in ${insertedBatches} batch(es); the import was rolled back, nothing was committed. Retry the import.`,
    details: { insertedRows, insertedBatches, committedRows: 0, retryable: true },
    cause: error.cause,
  });
};
