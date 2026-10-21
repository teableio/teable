/* eslint-disable sonarjs/no-duplicate-string */
import { FieldType } from './constant';
import type { IConditionalRollupFieldOptions } from './derivate';
import type { ILookupOptionsRo } from './lookup-options-base.schema';
import { validateFieldOptions } from './zod-error';

describe('validateFieldOptions - conditional rollup filter', () => {
  const lookupOptions: ILookupOptionsRo = {
    foreignTableId: 'foreign-table',
    lookupFieldId: 'lookup-field',
    linkFieldId: 'link-field',
  };

  const baseOptions: Partial<IConditionalRollupFieldOptions> = {
    expression: 'count({values})',
  };

  it('should require filter for conditional rollup options', () => {
    const result = validateFieldOptions({
      type: FieldType.ConditionalRollup,
      options: baseOptions,
      lookupOptions,
    });

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ i18nKey: 'sdk:editor.conditionalRollup.filterRequired' }),
      ])
    );
  });

  it('should reject empty filter definitions', () => {
    const result = validateFieldOptions({
      type: FieldType.ConditionalRollup,
      options: {
        ...baseOptions,
        filter: {
          conjunction: 'and',
          filterSet: [],
        },
      },
      lookupOptions,
    });

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ i18nKey: 'sdk:editor.conditionalRollup.filterRequired' }),
      ])
    );
  });

  it('should accept options when filter contains at least one condition', () => {
    const result = validateFieldOptions({
      type: FieldType.ConditionalRollup,
      options: {
        ...baseOptions,
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: 'foreign-field',
              operator: 'is',
              value: 'value',
            },
          ],
        },
      },
      lookupOptions,
    });

    expect(result).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ i18nKey: 'sdk:editor.conditionalRollup.filterRequired' }),
      ])
    );
  });
});

describe('validateFieldOptions - select choice names', () => {
  const existingChoices = [
    { id: 'choA', name: 'A', color: 'blue' },
    { id: 'choB', name: 'B', color: 'red' },
  ];

  it.each(['A', ' A '])(
    'reports the existing name for duplicate choice %j and does not add a choice',
    (name) => {
      const choices = [...existingChoices, { id: 'choDup', name, color: 'green' }];
      const options = { choices };

      const result = validateFieldOptions({
        type: FieldType.SingleSelect,
        options,
      });

      expect(result).toEqual([
        expect.objectContaining({
          message: 'Choice name A already exists',
          i18nKey: 'sdk:httpErrors.field.choiceNameAlreadyExists',
          context: { name: 'A' },
        }),
      ]);
      expect(options.choices).toEqual(choices);
      expect(options.choices.map((choice) => choice.name)).toEqual(['A', 'B', name]);
    }
  );
});
