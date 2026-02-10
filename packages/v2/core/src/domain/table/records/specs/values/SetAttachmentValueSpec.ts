import type { Result } from 'neverthrow';

import type { DomainError } from '../../../../shared/DomainError';
import { MutateOnlySpec } from '../../../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../../../fields/FieldId';
import type { TableRecord } from '../../TableRecord';
import type { CellValue } from '../../values/CellValue';
import type { ICellValueSpecVisitor } from './ICellValueSpecVisitor';

/**
 * Attachment item structure
 */
export interface AttachmentItem {
  id: string;
  name: string;
  path: string;
  token: string;
  size: number;
  mimetype: string;
  presignedUrl?: string;
  width?: number;
  height?: number;
}

/**
 * Specification for setting an attachment field value.
 * The value should be an array of attachment items.
 */
export class SetAttachmentValueSpec extends MutateOnlySpec<TableRecord, ICellValueSpecVisitor> {
  constructor(
    readonly fieldId: FieldId,
    readonly value: CellValue<AttachmentItem[]>
  ) {
    super();
  }

  mutate(record: TableRecord): Result<TableRecord, DomainError> {
    return record.setFieldValue(this.fieldId, this.value);
  }

  accept(visitor: ICellValueSpecVisitor): Result<void, DomainError> {
    return visitor.visitSetAttachmentValue(this);
  }
}
