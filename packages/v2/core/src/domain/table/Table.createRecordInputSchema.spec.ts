import { describe, expect, it } from 'vitest';

import { BaseId } from '../base/BaseId';
import { FieldName } from './fields/FieldName';
import { FieldNotNull } from './fields/types/FieldNotNull';
import { FormulaExpression } from './fields/types/FormulaExpression';
import { LinkFieldConfig } from './fields/types/LinkFieldConfig';
import { RatingMax } from './fields/types/RatingMax';
import { SelectOption } from './fields/types/SelectOption';
import { UserMultiplicity } from './fields/types/UserMultiplicity';
import { Table } from './Table';
import { TableName } from './TableName';
import { ViewName } from './views/ViewName';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldName = (name: string) => FieldName.create(name)._unsafeUnwrap();
const createTableName = (name: string) => TableName.create(name)._unsafeUnwrap();
const createViewName = (name: string) => ViewName.create(name)._unsafeUnwrap();

/**
 * Helper to build a table with a default grid view
 */
const buildTableWith = (
  configurator: (builder: ReturnType<typeof Table.builder>) => void
): ReturnType<ReturnType<typeof Table.builder>['build']> => {
  const builder = Table.builder().withBaseId(createBaseId('a')).withName(createTableName('Test'));
  configurator(builder);
  builder.view().grid().withName(createViewName('Grid')).done();
  return builder.build();
};

describe('Table.createRecordInputSchema', () => {
  // ============================================================
  // SingleLineText Field
  // ============================================================
  describe('SingleLineTextField', () => {
    it('generates schema for optional singleLineText field', () => {
      const result = buildTableWith((b) => {
        b.field()
          .singleLineText()
          .withName(createFieldName('Title'))
          .withNotNull(FieldNotNull.optional())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      expect(schemaResult.isOk()).toBe(true);

      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      // Valid values
      expect(schema.safeParse({ [fieldId]: 'hello' }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: '' }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(true);

      // Invalid values
      expect(schema.safeParse({ [fieldId]: 123 }).success).toBe(false);
      expect(schema.safeParse({ [fieldId]: true }).success).toBe(false);
      expect(schema.safeParse({ [fieldId]: [] }).success).toBe(false);
    });

    it('generates schema for required singleLineText field', () => {
      const result = buildTableWith((b) => {
        b.field()
          .singleLineText()
          .withName(createFieldName('Title'))
          .withNotNull(FieldNotNull.required())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      // Valid values
      expect(schema.safeParse({ [fieldId]: 'hello' }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: '' }).success).toBe(true);

      // Invalid values - null not allowed when required
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(false);
      expect(schema.safeParse({ [fieldId]: 123 }).success).toBe(false);
    });
  });

  // ============================================================
  // LongText Field
  // ============================================================
  describe('LongTextField', () => {
    it('generates schema for optional longText field', () => {
      const result = buildTableWith((b) => {
        b.field()
          .longText()
          .withName(createFieldName('Description'))
          .withNotNull(FieldNotNull.optional())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      expect(schema.safeParse({ [fieldId]: 'Long text content here...' }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: 123 }).success).toBe(false);
    });

    it('generates schema for required longText field', () => {
      const result = buildTableWith((b) => {
        b.field()
          .longText()
          .withName(createFieldName('Description'))
          .withNotNull(FieldNotNull.required())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      expect(schema.safeParse({ [fieldId]: 'Content' }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(false);
    });
  });

  // ============================================================
  // Number Field
  // ============================================================
  describe('NumberField', () => {
    it('generates schema for optional number field', () => {
      const result = buildTableWith((b) => {
        b.field()
          .number()
          .withName(createFieldName('Amount'))
          .withNotNull(FieldNotNull.optional())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      // Valid values
      expect(schema.safeParse({ [fieldId]: 100 }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: 0 }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: -50 }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: 3.14 }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(true);

      // Invalid values
      expect(schema.safeParse({ [fieldId]: '100' }).success).toBe(false);
      expect(schema.safeParse({ [fieldId]: 'abc' }).success).toBe(false);
      expect(schema.safeParse({ [fieldId]: true }).success).toBe(false);
    });

    it('generates schema for required number field', () => {
      const result = buildTableWith((b) => {
        b.field()
          .number()
          .withName(createFieldName('Amount'))
          .withNotNull(FieldNotNull.required())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      expect(schema.safeParse({ [fieldId]: 100 }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: 0 }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(false);
    });
  });

  // ============================================================
  // Rating Field
  // ============================================================
  describe('RatingField', () => {
    it('generates schema for optional rating field with default max (5)', () => {
      const result = buildTableWith((b) => {
        b.field()
          .rating()
          .withName(createFieldName('Stars'))
          .withNotNull(FieldNotNull.optional())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      // Valid values (1 to 5)
      expect(schema.safeParse({ [fieldId]: 1 }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: 3 }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: 5 }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(true);

      // Invalid values
      expect(schema.safeParse({ [fieldId]: 0 }).success).toBe(false); // min is 1
      expect(schema.safeParse({ [fieldId]: 6 }).success).toBe(false); // max is 5
      expect(schema.safeParse({ [fieldId]: 2.5 }).success).toBe(false); // must be integer
      expect(schema.safeParse({ [fieldId]: 'five' }).success).toBe(false);
    });

    it('generates schema for rating field with custom max (10)', () => {
      const result = buildTableWith((b) => {
        b.field()
          .rating()
          .withName(createFieldName('Score'))
          .withMax(RatingMax.create(10)._unsafeUnwrap())
          .withNotNull(FieldNotNull.optional())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      expect(schema.safeParse({ [fieldId]: 10 }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: 7 }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: 11 }).success).toBe(false); // exceeds max
    });

    it('generates schema for required rating field', () => {
      const result = buildTableWith((b) => {
        b.field()
          .rating()
          .withName(createFieldName('Rating'))
          .withNotNull(FieldNotNull.required())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      expect(schema.safeParse({ [fieldId]: 3 }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(false);
    });
  });

  // ============================================================
  // SingleSelect Field
  // ============================================================
  describe('SingleSelectField', () => {
    const createOption = (name: string) =>
      SelectOption.create({ name, color: 'blue' })._unsafeUnwrap();

    it('generates schema for optional singleSelect with options', () => {
      const opt1 = createOption('Option 1');
      const opt2 = createOption('Option 2');
      const opt3 = createOption('Option 3');

      const result = buildTableWith((b) => {
        b.field()
          .singleSelect()
          .withName(createFieldName('Status'))
          .withOptions([opt1, opt2, opt3])
          .withNotNull(FieldNotNull.optional())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      // Valid values - must be option IDs
      const optId1 = opt1.id().toString();
      const optId2 = opt2.id().toString();
      const optId3 = opt3.id().toString();
      expect(schema.safeParse({ [fieldId]: optId1 }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: optId2 }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: optId3 }).success).toBe(true);
      // Accept option names to match v1 behavior.
      expect(schema.safeParse({ [fieldId]: 'Option 1' }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(true);

      // Invalid values - unknown option ID or non-string
      expect(schema.safeParse({ [fieldId]: 'unknown' }).success).toBe(false);
      expect(schema.safeParse({ [fieldId]: 123 }).success).toBe(false);
    });

    it('generates schema for required singleSelect with options', () => {
      const opt1 = createOption('A');
      const opt2 = createOption('B');

      const result = buildTableWith((b) => {
        b.field()
          .singleSelect()
          .withName(createFieldName('Choice'))
          .withOptions([opt1, opt2])
          .withNotNull(FieldNotNull.required())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      const optId1 = opt1.id().toString();
      expect(schema.safeParse({ [fieldId]: optId1 }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(false);
    });

    it('generates schema for singleSelect without options (accepts null only)', () => {
      const result = buildTableWith((b) => {
        b.field()
          .singleSelect()
          .withName(createFieldName('Category'))
          .withNotNull(FieldNotNull.optional())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      // No options, only null is allowed
      expect(schema.safeParse({ [fieldId]: 'anything' }).success).toBe(false);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: 123 }).success).toBe(false);
    });
  });

  // ============================================================
  // MultipleSelect Field
  // ============================================================
  describe('MultipleSelectField', () => {
    const createOption = (name: string) =>
      SelectOption.create({ name, color: 'green' })._unsafeUnwrap();

    it('generates schema for optional multipleSelect with options', () => {
      const opt1 = createOption('Tag A');
      const opt2 = createOption('Tag B');

      const result = buildTableWith((b) => {
        b.field()
          .multipleSelect()
          .withName(createFieldName('Tags'))
          .withOptions([opt1, opt2])
          .withNotNull(FieldNotNull.optional())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      const optId1 = opt1.id().toString();
      const optId2 = opt2.id().toString();

      // Valid values - array of option IDs
      expect(schema.safeParse({ [fieldId]: [] }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: [optId1] }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: [optId1, optId2] }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(true);

      // Invalid values
      expect(schema.safeParse({ [fieldId]: ['unknown'] }).success).toBe(false); // unknown option
      expect(schema.safeParse({ [fieldId]: optId1 }).success).toBe(false); // not array
      expect(schema.safeParse({ [fieldId]: [123] }).success).toBe(false);
    });

    it('generates schema for required multipleSelect with options', () => {
      const opt1 = createOption('Category 1');

      const result = buildTableWith((b) => {
        b.field()
          .multipleSelect()
          .withName(createFieldName('Categories'))
          .withOptions([opt1])
          .withNotNull(FieldNotNull.required())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      const optId1 = opt1.id().toString();
      expect(schema.safeParse({ [fieldId]: [optId1] }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: [] }).success).toBe(true); // empty array is valid
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(false);
    });

    it('generates schema for multipleSelect without options', () => {
      const result = buildTableWith((b) => {
        b.field()
          .multipleSelect()
          .withName(createFieldName('Labels'))
          .withNotNull(FieldNotNull.optional())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      // No options, only empty array or null is allowed
      expect(schema.safeParse({ [fieldId]: [] }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: ['any', 'strings'] }).success).toBe(false);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(true);
    });
  });

  // ============================================================
  // Checkbox Field
  // ============================================================
  describe('CheckboxField', () => {
    it('generates schema for optional checkbox field', () => {
      const result = buildTableWith((b) => {
        b.field()
          .checkbox()
          .withName(createFieldName('Done'))
          .withNotNull(FieldNotNull.optional())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      // Valid values
      expect(schema.safeParse({ [fieldId]: true }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: false }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(true);

      // Invalid values
      expect(schema.safeParse({ [fieldId]: 'true' }).success).toBe(false);
      expect(schema.safeParse({ [fieldId]: 1 }).success).toBe(false);
      expect(schema.safeParse({ [fieldId]: 0 }).success).toBe(false);
    });

    it('generates schema for required checkbox field', () => {
      const result = buildTableWith((b) => {
        b.field()
          .checkbox()
          .withName(createFieldName('Verified'))
          .withNotNull(FieldNotNull.required())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      expect(schema.safeParse({ [fieldId]: true }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: false }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(false);
    });
  });

  // ============================================================
  // Date Field
  // ============================================================
  describe('DateField', () => {
    it('generates schema for optional date field', () => {
      const result = buildTableWith((b) => {
        b.field()
          .date()
          .withName(createFieldName('Due Date'))
          .withNotNull(FieldNotNull.optional())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      // Valid values - ISO 8601 datetime strings
      expect(schema.safeParse({ [fieldId]: '2024-01-15T10:30:00Z' }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: '2024-12-31T23:59:59.999Z' }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: new Date('2024-01-15T10:30:00Z') }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(true);

      // Invalid values
      expect(schema.safeParse({ [fieldId]: '2024-01-15' }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: 'not a date' }).success).toBe(false);
      expect(schema.safeParse({ [fieldId]: 1705315800000 }).success).toBe(false); // timestamp
    });

    it('generates schema for required date field', () => {
      const result = buildTableWith((b) => {
        b.field()
          .date()
          .withName(createFieldName('Created'))
          .withNotNull(FieldNotNull.required())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      expect(schema.safeParse({ [fieldId]: '2024-06-15T12:00:00Z' }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(false);
    });
  });

  // ============================================================
  // Attachment Field
  // ============================================================
  describe('AttachmentField', () => {
    const validAttachment = {
      id: 'att123',
      name: 'document.pdf',
      path: '/uploads/document.pdf',
      token: 'abc123',
      size: 1024,
      mimetype: 'application/pdf',
    };

    const attachmentWithOptionals = {
      ...validAttachment,
      presignedUrl: 'https://example.com/signed-url',
      width: 800,
      height: 600,
    };

    it('generates schema for optional attachment field', () => {
      const result = buildTableWith((b) => {
        b.field()
          .attachment()
          .withName(createFieldName('Files'))
          .withNotNull(FieldNotNull.optional())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      // Valid values
      expect(schema.safeParse({ [fieldId]: [] }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: [validAttachment] }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: [attachmentWithOptionals] }).success).toBe(true);
      expect(
        schema.safeParse({ [fieldId]: [validAttachment, attachmentWithOptionals] }).success
      ).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(true);

      // Invalid values
      expect(schema.safeParse({ [fieldId]: validAttachment }).success).toBe(false); // not array
      expect(schema.safeParse({ [fieldId]: [{ id: 'only-id' }] }).success).toBe(false); // missing fields
    });

    it('generates schema for required attachment field', () => {
      const result = buildTableWith((b) => {
        b.field()
          .attachment()
          .withName(createFieldName('Photos'))
          .withNotNull(FieldNotNull.required())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      expect(schema.safeParse({ [fieldId]: [validAttachment] }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: [] }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(false);
    });
  });

  // ============================================================
  // User Field
  // ============================================================
  describe('UserField', () => {
    const validUser = {
      id: 'usr123',
      title: 'John Doe',
    };

    const userWithOptionals = {
      ...validUser,
      email: 'john@example.com',
      avatarUrl: 'https://example.com/avatar.jpg',
    };

    it('generates schema for optional single user field', () => {
      const result = buildTableWith((b) => {
        b.field()
          .user()
          .withName(createFieldName('Assignee'))
          .withMultiplicity(UserMultiplicity.single())
          .withNotNull(FieldNotNull.optional())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      // Valid values
      expect(schema.safeParse({ [fieldId]: validUser }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: userWithOptionals }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(true);

      // Invalid values
      expect(schema.safeParse({ [fieldId]: [validUser] }).success).toBe(false); // array not allowed
      expect(schema.safeParse({ [fieldId]: { id: 'only-id' } }).success).toBe(false); // missing title
    });

    it('generates schema for required single user field', () => {
      const result = buildTableWith((b) => {
        b.field()
          .user()
          .withName(createFieldName('Owner'))
          .withMultiplicity(UserMultiplicity.single())
          .withNotNull(FieldNotNull.required())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      expect(schema.safeParse({ [fieldId]: validUser }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(false);
    });

    it('generates schema for optional multiple user field', () => {
      const result = buildTableWith((b) => {
        b.field()
          .user()
          .withName(createFieldName('Team'))
          .withMultiplicity(UserMultiplicity.multiple())
          .withNotNull(FieldNotNull.optional())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      // Valid values
      expect(schema.safeParse({ [fieldId]: [] }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: [validUser] }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: [validUser, userWithOptionals] }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(true);

      // Invalid values
      expect(schema.safeParse({ [fieldId]: validUser }).success).toBe(false); // not array
    });

    it('generates schema for required multiple user field', () => {
      const result = buildTableWith((b) => {
        b.field()
          .user()
          .withName(createFieldName('Reviewers'))
          .withMultiplicity(UserMultiplicity.multiple())
          .withNotNull(FieldNotNull.required())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      expect(schema.safeParse({ [fieldId]: [validUser] }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(false);
    });
  });

  // ============================================================
  // Link Field
  // ============================================================
  describe('LinkField', () => {
    const validLink = {
      id: 'rec123',
      title: 'Linked Record',
    };

    const linkWithoutTitle = {
      id: 'rec456',
    };

    const createLinkConfig = (params: {
      relationship: string;
      foreignTableId: string;
      lookupFieldId: string;
    }) =>
      LinkFieldConfig.create({
        relationship: params.relationship,
        foreignTableId: params.foreignTableId,
        lookupFieldId: params.lookupFieldId,
      })._unsafeUnwrap();

    it('generates schema for optional single link field', () => {
      const foreignTableId = `tbl${'f'.repeat(16)}`;
      const lookupFieldId = `fld${'f'.repeat(16)}`;
      const config = createLinkConfig({
        relationship: 'manyOne',
        foreignTableId,
        lookupFieldId,
      });

      const result = buildTableWith((b) => {
        b.field()
          .link()
          .withName(createFieldName('Related'))
          .withConfig(config)
          .withNotNull(FieldNotNull.optional())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      // Valid values
      expect(schema.safeParse({ [fieldId]: validLink }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: linkWithoutTitle }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(true);

      // Invalid values
      expect(schema.safeParse({ [fieldId]: [validLink] }).success).toBe(false); // array not allowed
      expect(schema.safeParse({ [fieldId]: { title: 'No ID' } }).success).toBe(false);
    });

    it('generates schema for optional multiple link field', () => {
      const foreignTableId = `tbl${'g'.repeat(16)}`;
      const lookupFieldId = `fld${'g'.repeat(16)}`;
      const config = createLinkConfig({
        relationship: 'manyMany',
        foreignTableId,
        lookupFieldId,
      });

      const result = buildTableWith((b) => {
        b.field()
          .link()
          .withName(createFieldName('Links'))
          .withConfig(config)
          .withNotNull(FieldNotNull.optional())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      // Valid values
      expect(schema.safeParse({ [fieldId]: [] }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: [validLink] }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: [validLink, linkWithoutTitle] }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(true);

      // Invalid values
      expect(schema.safeParse({ [fieldId]: validLink }).success).toBe(false); // not array
    });

    it('generates schema for required link field', () => {
      const foreignTableId = `tbl${'h'.repeat(16)}`;
      const lookupFieldId = `fld${'h'.repeat(16)}`;
      const config = createLinkConfig({
        relationship: 'manyOne',
        foreignTableId,
        lookupFieldId,
      });

      const result = buildTableWith((b) => {
        b.field()
          .link()
          .withName(createFieldName('Parent'))
          .withConfig(config)
          .withNotNull(FieldNotNull.required())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();
      const fieldId = table.getFields()[0].id().toString();

      expect(schema.safeParse({ [fieldId]: validLink }).success).toBe(true);
      expect(schema.safeParse({ [fieldId]: null }).success).toBe(false);
    });
  });

  // ============================================================
  // Computed Fields (should be excluded from input schema)
  // ============================================================
  describe('Computed fields (excluded)', () => {
    it('excludes formula field from input schema', () => {
      const result = buildTableWith((b) => {
        b.field().singleLineText().withName(createFieldName('Name')).primary().done();
        b.field()
          .formula()
          .withName(createFieldName('Computed'))
          .withExpression(FormulaExpression.create('1+1')._unsafeUnwrap())
          .done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();

      // Schema should only have the Name field, not the formula
      const schemaKeys = Object.keys(schema.shape);
      expect(schemaKeys.length).toBe(1);
    });

    it('excludes createdTime field from input schema', () => {
      const result = buildTableWith((b) => {
        b.field().singleLineText().withName(createFieldName('Title')).primary().done();
        b.field().createdTime().withName(createFieldName('Created')).done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();

      const schemaKeys = Object.keys(schema.shape);
      expect(schemaKeys.length).toBe(1);
    });

    it('excludes lastModifiedTime field from input schema', () => {
      const result = buildTableWith((b) => {
        b.field().singleLineText().withName(createFieldName('Title')).primary().done();
        b.field().lastModifiedTime().withName(createFieldName('Updated')).done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();

      const schemaKeys = Object.keys(schema.shape);
      expect(schemaKeys.length).toBe(1);
    });

    it('excludes createdBy field from input schema', () => {
      const result = buildTableWith((b) => {
        b.field().singleLineText().withName(createFieldName('Title')).primary().done();
        b.field().createdBy().withName(createFieldName('Creator')).done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();

      const schemaKeys = Object.keys(schema.shape);
      expect(schemaKeys.length).toBe(1);
    });

    it('excludes lastModifiedBy field from input schema', () => {
      const result = buildTableWith((b) => {
        b.field().singleLineText().withName(createFieldName('Title')).primary().done();
        b.field().lastModifiedBy().withName(createFieldName('Modifier')).done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();

      const schemaKeys = Object.keys(schema.shape);
      expect(schemaKeys.length).toBe(1);
    });

    it('excludes autoNumber field from input schema', () => {
      const result = buildTableWith((b) => {
        b.field().singleLineText().withName(createFieldName('Title')).primary().done();
        b.field().autoNumber().withName(createFieldName('ID')).done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();

      const schemaKeys = Object.keys(schema.shape);
      expect(schemaKeys.length).toBe(1);
    });

    it('generates null/undefined-only schema for button field', () => {
      // Note: Button field is NOT computed, so it's included in the schema,
      // but the visitor returns z.null().optional() since it doesn't accept user values.
      const result = buildTableWith((b) => {
        b.field().singleLineText().withName(createFieldName('Title')).primary().done();
        b.field().button().withName(createFieldName('Action')).done();
      });
      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();

      // Both fields are included
      const schemaKeys = Object.keys(schema.shape);
      expect(schemaKeys.length).toBe(2);

      // Find field IDs
      const titleField = table.getFields().find((f) => f.type().toString() === 'singleLineText')!;
      const buttonField = table.getFields().find((f) => f.type().toString() === 'button')!;
      const titleFieldId = titleField.id().toString();
      const buttonFieldId = buttonField.id().toString();

      // Button field only accepts null/undefined
      expect(schema.safeParse({ [titleFieldId]: 'test', [buttonFieldId]: null }).success).toBe(
        true
      );
      expect(schema.safeParse({ [titleFieldId]: 'test', [buttonFieldId]: undefined }).success).toBe(
        true
      );
      expect(schema.safeParse({ [titleFieldId]: 'test' }).success).toBe(true); // button optional
      expect(schema.safeParse({ [titleFieldId]: 'test', [buttonFieldId]: 'click' }).success).toBe(
        false
      ); // string not allowed
    });
  });

  // ============================================================
  // Multiple fields together
  // ============================================================
  describe('Multiple fields', () => {
    it('generates combined schema for multiple editable fields', () => {
      const opt1 = SelectOption.create({ name: 'Active', color: 'blue' })._unsafeUnwrap();

      const result = buildTableWith((b) => {
        b.field()
          .singleLineText()
          .withName(createFieldName('Name'))
          .withNotNull(FieldNotNull.required())
          .primary()
          .done();
        b.field()
          .number()
          .withName(createFieldName('Age'))
          .withNotNull(FieldNotNull.optional())
          .done();
        b.field()
          .singleSelect()
          .withName(createFieldName('Status'))
          .withOptions([opt1])
          .withNotNull(FieldNotNull.required())
          .done();
        b.field()
          .checkbox()
          .withName(createFieldName('Active'))
          .withNotNull(FieldNotNull.optional())
          .done();
        // Computed field - should be excluded
        b.field().createdTime().withName(createFieldName('Created')).done();
      });

      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();

      // Should have 4 editable fields (excludes createdTime)
      const schemaKeys = Object.keys(schema.shape);
      expect(schemaKeys.length).toBe(4);

      // Find field IDs
      const fields = table.getFields();
      const nameField = fields.find((f) => f.name().toString() === 'Name')!;
      const ageField = fields.find((f) => f.name().toString() === 'Age')!;
      const statusField = fields.find((f) => f.name().toString() === 'Status')!;
      const activeField = fields.find((f) => f.name().toString() === 'Active')!;

      // Valid complete record
      const opt1Id = opt1.id().toString();
      const validRecord = {
        [nameField.id().toString()]: 'John',
        [ageField.id().toString()]: 25,
        [statusField.id().toString()]: opt1Id,
        [activeField.id().toString()]: true,
      };
      expect(schema.safeParse(validRecord).success).toBe(true);

      // Valid record with nulls for optional fields
      const recordWithNulls = {
        [nameField.id().toString()]: 'Jane',
        [ageField.id().toString()]: null,
        [statusField.id().toString()]: opt1Id,
        [activeField.id().toString()]: null,
      };
      expect(schema.safeParse(recordWithNulls).success).toBe(true);

      // Invalid - required field is null
      const invalidRecord = {
        [nameField.id().toString()]: null, // required!
        [ageField.id().toString()]: 30,
        [statusField.id().toString()]: opt1Id,
        [activeField.id().toString()]: false,
      };
      expect(schema.safeParse(invalidRecord).success).toBe(false);
    });

    it('handles table with only computed fields', () => {
      const result = buildTableWith((b) => {
        b.field().singleLineText().withName(createFieldName('Title')).primary().done();
        b.field().createdTime().withName(createFieldName('Created')).done();
        b.field().lastModifiedTime().withName(createFieldName('Updated')).done();
        b.field().autoNumber().withName(createFieldName('ID')).done();
      });

      const table = result._unsafeUnwrap();
      const schemaResult = table.createRecordInputSchema();
      const schema = schemaResult._unsafeUnwrap();

      // Only Title (primary) is editable
      const schemaKeys = Object.keys(schema.shape);
      expect(schemaKeys.length).toBe(1);
    });
  });
});
