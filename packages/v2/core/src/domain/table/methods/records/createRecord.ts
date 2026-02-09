import type { Result } from 'neverthrow';
import type { DomainError } from '../../../shared/DomainError';
import type { RecordCreateSource } from '../../events/RecordFieldValuesDTO';
import type { RecordCreateResult } from '../../records/RecordCreateResult';
import type { Table } from '../../Table';
import { buildRecordWithSpec } from './recordBuilders';

export function createRecord(
  this: Table,
  fieldValues: ReadonlyMap<string, unknown>,
  options?: { typecast?: boolean; source?: RecordCreateSource }
): Result<RecordCreateResult, DomainError> {
  return buildRecordWithSpec.call(this, fieldValues, undefined, options);
}
