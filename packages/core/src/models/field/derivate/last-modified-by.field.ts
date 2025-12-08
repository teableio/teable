import type { FieldType } from '../constant';
import type { IFieldVisitor } from '../field-visitor.interface';
import { UserAbstractCore } from './abstract/user.field.abstract';
import type { IFormulaFieldMeta } from './formula-option.schema';
import type { ILastModifiedByFieldOptions } from './last-modified-by-option.schema';
import { lastModifiedByFieldOptionsSchema } from './last-modified-by-option.schema';

export class LastModifiedByFieldCore extends UserAbstractCore {
  type!: FieldType.LastModifiedBy;
  options!: ILastModifiedByFieldOptions;
  declare meta?: IFormulaFieldMeta;

  override get isStructuredCellValue() {
    return true;
  }

  convertStringToCellValue(_value: string) {
    return null;
  }

  getTrackedFieldIds(): string[] {
    return this.options?.trackedFieldIds ?? [];
  }

  isTrackAll(): boolean {
    return this.getTrackedFieldIds().length === 0;
  }

  shouldUpdate(changedFieldIds: Set<string>): boolean {
    const trackedFieldIds = this.getTrackedFieldIds();
    return this.isTrackAll() || trackedFieldIds.some((id) => changedFieldIds.has(id));
  }

  getIsPersistedAsGeneratedColumn(): boolean {
    return this.meta?.persistedAsGeneratedColumn === true;
  }

  shouldPersistAuditValue(): boolean {
    return !this.isLookup && !this.getIsPersistedAsGeneratedColumn();
  }

  repair(_value: unknown) {
    return null;
  }

  validateOptions() {
    return lastModifiedByFieldOptionsSchema.safeParse(this.options);
  }

  accept<T>(visitor: IFieldVisitor<T>): T {
    return visitor.visitLastModifiedByField(this);
  }
}
