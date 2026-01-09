import type { Faker } from '@faker-js/faker';
import {
  AbstractFieldVisitor,
  type DomainError,
  type SingleLineTextField,
  type LongTextField,
  type NumberField,
  type RatingField,
  type FormulaField,
  type RollupField,
  type SingleSelectField,
  type MultipleSelectField,
  type CheckboxField,
  type AttachmentField,
  type DateField,
  type CreatedTimeField,
  type LastModifiedTimeField,
  type UserField,
  type CreatedByField,
  type LastModifiedByField,
  type AutoNumberField,
  type ButtonField,
  type LinkField,
  type ConditionalRollupField,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { MockValueGenerator, MockRecordContext } from '../types';

/**
 * Visitor that generates mock value generators for each field type.
 * Returns a function that, when called with a faker instance and context,
 * produces a mock value appropriate for the field type.
 */
export class FieldMockValueVisitor extends AbstractFieldVisitor<MockValueGenerator> {
  private constructor() {
    super();
  }

  static create(): FieldMockValueVisitor {
    return new FieldMockValueVisitor();
  }

  // --- Text Fields ---

  visitSingleLineTextField(field: SingleLineTextField): Result<MockValueGenerator, DomainError> {
    const showAs = field.showAs();

    if (showAs) {
      const type = showAs.type();
      switch (type) {
        case 'email':
          return ok((faker: Faker) => faker.internet.email());
        case 'url':
          return ok((faker: Faker) => faker.internet.url());
        case 'phone':
          return ok((faker: Faker) => faker.phone.number());
      }
    }

    // Default: generate a person name
    return ok((faker: Faker) => faker.person.fullName());
  }

  visitLongTextField(_field: LongTextField): Result<MockValueGenerator, DomainError> {
    return ok((faker: Faker) => faker.lorem.paragraph());
  }

  // --- Number Fields ---

  visitNumberField(_field: NumberField): Result<MockValueGenerator, DomainError> {
    return ok((faker: Faker) => faker.number.float({ min: 0, max: 1000, fractionDigits: 2 }));
  }

  visitRatingField(field: RatingField): Result<MockValueGenerator, DomainError> {
    const max = field.ratingMax().toNumber();
    return ok((faker: Faker) => faker.number.int({ min: 1, max }));
  }

  // --- Select Fields ---

  visitSingleSelectField(field: SingleSelectField): Result<MockValueGenerator, DomainError> {
    const options = field.selectOptions();
    if (options.length === 0) {
      return ok(() => null);
    }
    const optionIds = options.map((opt) => opt.id().toString());
    return ok((faker: Faker) => faker.helpers.arrayElement(optionIds));
  }

  visitMultipleSelectField(field: MultipleSelectField): Result<MockValueGenerator, DomainError> {
    const options = field.selectOptions();
    if (options.length === 0) {
      return ok(() => null);
    }
    const optionIds = options.map((opt) => opt.id().toString());
    return ok((faker: Faker) =>
      faker.helpers.arrayElements(optionIds, { min: 1, max: Math.min(3, optionIds.length) })
    );
  }

  // --- Boolean/Checkbox ---

  visitCheckboxField(_field: CheckboxField): Result<MockValueGenerator, DomainError> {
    return ok((faker: Faker) => faker.datatype.boolean());
  }

  // --- Date ---

  visitDateField(_field: DateField): Result<MockValueGenerator, DomainError> {
    return ok((faker: Faker) => faker.date.recent({ days: 365 }).toISOString());
  }

  // --- Attachment ---

  visitAttachmentField(_field: AttachmentField): Result<MockValueGenerator, DomainError> {
    return ok((faker: Faker) => {
      const count = faker.number.int({ min: 0, max: 2 });
      if (count === 0) return null;

      return Array.from({ length: count }, () => ({
        id: faker.string.uuid(),
        name: faker.system.fileName(),
        path: `/attachments/${faker.string.uuid()}`,
        token: faker.string.alphanumeric(32),
        size: faker.number.int({ min: 1000, max: 5000000 }),
        mimetype: faker.system.mimeType(),
      }));
    });
  }

  // --- User ---

  visitUserField(field: UserField): Result<MockValueGenerator, DomainError> {
    const isMultiple = field.multiplicity().toBoolean();

    const generateUser = (faker: Faker) => ({
      id: faker.string.uuid(),
      title: faker.person.fullName(),
      email: faker.internet.email(),
    });

    if (isMultiple) {
      return ok((faker: Faker) => {
        const count = faker.number.int({ min: 1, max: 3 });
        return Array.from({ length: count }, () => generateUser(faker));
      });
    }

    return ok((faker: Faker) => generateUser(faker));
  }

  // --- Link Field ---

  visitLinkField(field: LinkField): Result<MockValueGenerator, DomainError> {
    const foreignTableId = field.foreignTableId().toString();
    const isMultiple = field.isMultipleValue();

    return ok((faker: Faker, context: MockRecordContext) => {
      // Get created record IDs from the foreign table
      const foreignRecordIds = context.createdRecordIds.get(foreignTableId) ?? [];

      if (foreignRecordIds.length === 0) {
        return null; // No foreign records available yet
      }

      if (isMultiple) {
        const count = faker.number.int({ min: 1, max: Math.min(3, foreignRecordIds.length) });
        const selectedIds = faker.helpers.arrayElements(foreignRecordIds, count);
        return selectedIds.map((id) => ({ id }));
      } else {
        const selectedId = faker.helpers.arrayElement(foreignRecordIds);
        return [{ id: selectedId }];
      }
    });
  }

  // --- Computed Fields (skip - no mock value needed) ---

  visitFormulaField(_field: FormulaField): Result<MockValueGenerator, DomainError> {
    return ok(() => undefined);
  }

  visitRollupField(_field: RollupField): Result<MockValueGenerator, DomainError> {
    return ok(() => undefined);
  }

  visitConditionalRollupField(
    _field: ConditionalRollupField
  ): Result<MockValueGenerator, DomainError> {
    return ok(() => undefined);
  }

  // --- System Fields (skip - auto-generated) ---

  visitCreatedTimeField(_field: CreatedTimeField): Result<MockValueGenerator, DomainError> {
    return ok(() => undefined);
  }

  visitLastModifiedTimeField(
    _field: LastModifiedTimeField
  ): Result<MockValueGenerator, DomainError> {
    return ok(() => undefined);
  }

  visitCreatedByField(_field: CreatedByField): Result<MockValueGenerator, DomainError> {
    return ok(() => undefined);
  }

  visitLastModifiedByField(_field: LastModifiedByField): Result<MockValueGenerator, DomainError> {
    return ok(() => undefined);
  }

  visitAutoNumberField(_field: AutoNumberField): Result<MockValueGenerator, DomainError> {
    return ok(() => undefined);
  }

  visitButtonField(_field: ButtonField): Result<MockValueGenerator, DomainError> {
    return ok(() => undefined);
  }
}
