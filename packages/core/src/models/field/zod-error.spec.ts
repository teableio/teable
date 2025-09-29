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
