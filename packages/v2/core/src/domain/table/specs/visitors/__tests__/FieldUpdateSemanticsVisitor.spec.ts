import { describe, expect, it } from 'vitest';

import { FieldId } from '../../../fields/FieldId';
import { FieldName } from '../../../fields/FieldName';
import { DateTimeFormatting, TimeFormatting } from '../../../fields/types/DateTimeFormatting';
import { SelectOption } from '../../../fields/types/SelectOption';
import { SingleLineTextField } from '../../../fields/types/SingleLineTextField';
import { SingleSelectField } from '../../../fields/types/SingleSelectField';
import { TableUpdateFieldDescriptionSpec } from '../../TableUpdateFieldDescriptionSpec';
import { TableUpdateFieldTypeSpec } from '../../TableUpdateFieldTypeSpec';
import { UpdateDateFormattingSpec } from '../../field-updates/UpdateDateFormattingSpec';
import { FieldUpdateSemanticsVisitor } from '../FieldUpdateSemanticsVisitor';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();

describe('FieldUpdateSemanticsVisitor', () => {
  it('classifies date formatting updates as option-backed presence changes', () => {
    const visitor = new FieldUpdateSemanticsVisitor();
    const fieldId = createFieldId('a');
    const nextFormatting = DateTimeFormatting.create({
      date: 'YYYY-MM-DD',
      time: TimeFormatting.Hour12,
      timeZone: 'UTC',
    })._unsafeUnwrap();

    const semantics = visitor.visit(
      UpdateDateFormattingSpec.create(fieldId, DateTimeFormatting.default(), nextFormatting)
    );

    expect(semantics?.updatedProperties).toEqual(['formatting']);
    expect(semantics?.propertySemantics.formatting).toEqual({
      realtimePath: ['options'],
      presencePath: ['options', 'formatting'],
      mayRequirePresence: true,
    });
  });

  it('classifies description updates as top-level changes without presence', () => {
    const visitor = new FieldUpdateSemanticsVisitor();
    const fieldId = createFieldId('b');

    const semantics = visitor.visit(
      TableUpdateFieldDescriptionSpec.create(fieldId, 'old description', 'new description')
    );

    expect(semantics?.updatedProperties).toEqual(['description']);
    expect(semantics?.propertySemantics.description).toEqual({
      realtimePath: ['description'],
      presencePath: ['description'],
      mayRequirePresence: false,
    });
  });

  it('classifies field type conversions with type and options semantics', () => {
    const visitor = new FieldUpdateSemanticsVisitor();
    const fieldId = createFieldId('c');
    const fieldName = FieldName.create('Status')._unsafeUnwrap();
    const oldField = SingleLineTextField.create({
      id: fieldId,
      name: fieldName,
    })._unsafeUnwrap();
    const newField = SingleSelectField.create({
      id: fieldId,
      name: fieldName,
      options: [
        SelectOption.create({ id: 'opt1', name: 'Open', color: 'yellowBright' })._unsafeUnwrap(),
      ],
    })._unsafeUnwrap();

    const semantics = visitor.visit(TableUpdateFieldTypeSpec.create(oldField, newField));

    expect(semantics?.updatedProperties).toEqual(['type', 'options']);
    expect(semantics?.propertySemantics.type).toEqual({
      realtimePath: ['type'],
      presencePath: ['type'],
      mayRequirePresence: true,
    });
    expect(semantics?.propertySemantics.options).toEqual({
      realtimePath: ['options'],
      presencePath: ['options'],
      mayRequirePresence: true,
    });
  });
});
