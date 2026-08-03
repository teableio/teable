import type { FieldType } from '../constant';
import type { IFieldVisitor } from '../field-visitor.interface';
import { UserAbstractCore } from './abstract/user.field.abstract';
import {
  createdByFieldOptionsSchema,
  type ICreatedByFieldOptions,
} from './created-by-option.schema';
import type { IFormulaFieldMeta } from './formula-option.schema';

export class CreatedByFieldCore extends UserAbstractCore {
  type!: FieldType.CreatedBy;
  options!: ICreatedByFieldOptions;
  declare meta?: IFormulaFieldMeta;

  override get isStructuredCellValue() {
    return true;
  }

  convertStringToCellValue(_value: string) {
    return null;
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
    return createdByFieldOptionsSchema.safeParse(this.options);
  }

  accept<T>(visitor: IFieldVisitor<T>): T {
    return visitor.visitCreatedByField(this);
  }
}
