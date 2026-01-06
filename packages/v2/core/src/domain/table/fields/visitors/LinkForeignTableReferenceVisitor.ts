import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../../../base/BaseId';
import type { DomainError } from '../../../shared/DomainError';
import type { TableId } from '../../TableId';
import type { Field } from '../Field';
import type { AttachmentField } from '../types/AttachmentField';
import type { AutoNumberField } from '../types/AutoNumberField';
import type { ButtonField } from '../types/ButtonField';
import type { CheckboxField } from '../types/CheckboxField';
import type { ConditionalLookupField } from '../types/ConditionalLookupField';
import type { ConditionalRollupField } from '../types/ConditionalRollupField';
import type { CreatedByField } from '../types/CreatedByField';
import type { CreatedTimeField } from '../types/CreatedTimeField';
import type { DateField } from '../types/DateField';
import type { FormulaField } from '../types/FormulaField';
import type { LastModifiedByField } from '../types/LastModifiedByField';
import type { LastModifiedTimeField } from '../types/LastModifiedTimeField';
import type { LinkField } from '../types/LinkField';
import type { LongTextField } from '../types/LongTextField';
import type { LookupField } from '../types/LookupField';
import type { MultipleSelectField } from '../types/MultipleSelectField';
import type { NumberField } from '../types/NumberField';
import type { RatingField } from '../types/RatingField';
import type { RollupField } from '../types/RollupField';
import type { SingleLineTextField } from '../types/SingleLineTextField';
import type { SingleSelectField } from '../types/SingleSelectField';
import type { UserField } from '../types/UserField';
import type { IFieldVisitor } from './IFieldVisitor';

export type LinkForeignTableReference = {
  foreignTableId: TableId;
  baseId?: BaseId;
};

export class LinkForeignTableReferenceVisitor
  implements IFieldVisitor<ReadonlyArray<LinkForeignTableReference>>
{
  collect(
    fields: ReadonlyArray<Field>
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    const results: LinkForeignTableReference[] = [];
    for (const field of fields) {
      const result = field.accept(this);
      if (result.isErr()) {
        return result;
      }
      results.push(...result.value);
    }

    const unique: LinkForeignTableReference[] = [];
    const seen = new Set<string>();
    for (const ref of results) {
      const key = ref.foreignTableId.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(ref);
    }
    return ok(unique);
  }

  visitSingleLineTextField(
    _: SingleLineTextField
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  visitLongTextField(
    _: LongTextField
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  visitNumberField(_: NumberField): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  visitRatingField(_: RatingField): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  visitFormulaField(
    _: FormulaField
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  visitRollupField(
    field: RollupField
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([
      {
        foreignTableId: field.foreignTableId(),
      },
    ]);
  }

  visitSingleSelectField(
    _: SingleSelectField
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  visitMultipleSelectField(
    _: MultipleSelectField
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  visitCheckboxField(
    _: CheckboxField
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  visitAttachmentField(
    _: AttachmentField
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  visitDateField(_: DateField): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  visitCreatedTimeField(
    _: CreatedTimeField
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  visitLastModifiedTimeField(
    _: LastModifiedTimeField
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  visitUserField(_: UserField): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  visitCreatedByField(
    _: CreatedByField
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  visitLastModifiedByField(
    _: LastModifiedByField
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  visitAutoNumberField(
    _: AutoNumberField
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  visitButtonField(_: ButtonField): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([]);
  }

  visitLinkField(field: LinkField): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    return ok([
      {
        foreignTableId: field.foreignTableId(),
        baseId: field.baseId(),
      },
    ]);
  }

  visitLookupField(
    field: LookupField
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    // Lookup fields reference foreign tables through their link field
    return ok([
      {
        foreignTableId: field.foreignTableId(),
      },
    ]);
  }

  visitConditionalRollupField(
    field: ConditionalRollupField
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    // Conditional rollup fields reference foreign tables directly
    return ok([
      {
        foreignTableId: field.foreignTableId(),
      },
    ]);
  }

  visitConditionalLookupField(
    field: ConditionalLookupField
  ): Result<ReadonlyArray<LinkForeignTableReference>, DomainError> {
    // Conditional lookup fields reference foreign tables directly
    return ok([
      {
        foreignTableId: field.foreignTableId(),
      },
    ]);
  }
}
