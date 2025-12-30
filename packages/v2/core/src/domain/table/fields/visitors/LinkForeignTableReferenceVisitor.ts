import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { BaseId } from '../../../base/BaseId';
import type { TableId } from '../../TableId';
import type { Field } from '../Field';
import type { AttachmentField } from '../types/AttachmentField';
import type { AutoNumberField } from '../types/AutoNumberField';
import type { ButtonField } from '../types/ButtonField';
import type { CheckboxField } from '../types/CheckboxField';
import type { CreatedByField } from '../types/CreatedByField';
import type { CreatedTimeField } from '../types/CreatedTimeField';
import type { DateField } from '../types/DateField';
import type { FormulaField } from '../types/FormulaField';
import type { LastModifiedByField } from '../types/LastModifiedByField';
import type { LastModifiedTimeField } from '../types/LastModifiedTimeField';
import type { LinkField } from '../types/LinkField';
import type { LongTextField } from '../types/LongTextField';
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
  collect(fields: ReadonlyArray<Field>): Result<ReadonlyArray<LinkForeignTableReference>, string> {
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
  ): Result<ReadonlyArray<LinkForeignTableReference>, string> {
    return ok([]);
  }

  visitLongTextField(_: LongTextField): Result<ReadonlyArray<LinkForeignTableReference>, string> {
    return ok([]);
  }

  visitNumberField(_: NumberField): Result<ReadonlyArray<LinkForeignTableReference>, string> {
    return ok([]);
  }

  visitRatingField(_: RatingField): Result<ReadonlyArray<LinkForeignTableReference>, string> {
    return ok([]);
  }

  visitFormulaField(_: FormulaField): Result<ReadonlyArray<LinkForeignTableReference>, string> {
    return ok([]);
  }

  visitRollupField(field: RollupField): Result<ReadonlyArray<LinkForeignTableReference>, string> {
    return ok([
      {
        foreignTableId: field.foreignTableId(),
      },
    ]);
  }

  visitSingleSelectField(
    _: SingleSelectField
  ): Result<ReadonlyArray<LinkForeignTableReference>, string> {
    return ok([]);
  }

  visitMultipleSelectField(
    _: MultipleSelectField
  ): Result<ReadonlyArray<LinkForeignTableReference>, string> {
    return ok([]);
  }

  visitCheckboxField(_: CheckboxField): Result<ReadonlyArray<LinkForeignTableReference>, string> {
    return ok([]);
  }

  visitAttachmentField(
    _: AttachmentField
  ): Result<ReadonlyArray<LinkForeignTableReference>, string> {
    return ok([]);
  }

  visitDateField(_: DateField): Result<ReadonlyArray<LinkForeignTableReference>, string> {
    return ok([]);
  }

  visitCreatedTimeField(
    _: CreatedTimeField
  ): Result<ReadonlyArray<LinkForeignTableReference>, string> {
    return ok([]);
  }

  visitLastModifiedTimeField(
    _: LastModifiedTimeField
  ): Result<ReadonlyArray<LinkForeignTableReference>, string> {
    return ok([]);
  }

  visitUserField(_: UserField): Result<ReadonlyArray<LinkForeignTableReference>, string> {
    return ok([]);
  }

  visitCreatedByField(_: CreatedByField): Result<ReadonlyArray<LinkForeignTableReference>, string> {
    return ok([]);
  }

  visitLastModifiedByField(
    _: LastModifiedByField
  ): Result<ReadonlyArray<LinkForeignTableReference>, string> {
    return ok([]);
  }

  visitAutoNumberField(
    _: AutoNumberField
  ): Result<ReadonlyArray<LinkForeignTableReference>, string> {
    return ok([]);
  }

  visitButtonField(_: ButtonField): Result<ReadonlyArray<LinkForeignTableReference>, string> {
    return ok([]);
  }

  visitLinkField(field: LinkField): Result<ReadonlyArray<LinkForeignTableReference>, string> {
    return ok([
      {
        foreignTableId: field.foreignTableId(),
        baseId: field.baseId(),
      },
    ]);
  }
}
