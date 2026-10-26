/**
 * Shared synthetic base for the repro pipeline tests. Names and the view-filter
 * literal are deliberately distinctive so the sanitization test can search the
 * emitted artifact for leaks.
 */
export const SECRET_TABLE_NAME = 'Zecret Customer Ledger';
export const SECRET_TABLE_NAME_B = 'Zecret Partner Registry';
export const SECRET_FIELD_NAME = 'Zeta Secret Amount';
export const SECRET_CHOICE_NAME = 'ZEKRET-CHOICE-CLASSIFIED';
export const SECRET_CELL_VALUE = 'ZEKRET-CELL-VALUE-42';

const fld = (char: string) => `fld${char.repeat(16)}`;

export const TABLE_A = 'tblAAAAAAAAAAAAAAAA';
export const TABLE_B = 'tblBBBBBBBBBBBBBBBB';

export const FIELD = {
  title: fld('a'),
  amount: fld('b'),
  formula: fld('c'),
  link: fld('d'),
  partnerName: fld('e'),
  lookup: fld('f'),
  rollup: fld('g'),
  partnerAmount: fld('h'),
  category: fld('i'),
} as const;

export const syntheticStructure = () => ({
  name: SECRET_TABLE_NAME,
  tables: [
    {
      id: TABLE_A,
      name: SECRET_TABLE_NAME,
      fields: [
        { id: FIELD.title, name: 'Zeta Secret Title', type: 'singleLineText', isPrimary: true },
        { id: FIELD.amount, name: SECRET_FIELD_NAME, type: 'number' },
        {
          id: FIELD.formula,
          name: 'Zeta Secret Double',
          type: 'formula',
          options: { expression: `{${FIELD.amount}}*2` },
          cellValueType: 'number',
          isMultipleCellValue: false,
        },
        {
          id: FIELD.link,
          name: 'Zeta Secret Partner',
          type: 'link',
          options: {
            relationship: 'manyMany',
            foreignTableId: TABLE_B,
            lookupFieldId: FIELD.partnerName,
          },
        },
        {
          id: FIELD.lookup,
          name: 'Zeta Secret Partner Title',
          type: 'lookup',
          options: {},
          lookupOptions: {
            linkFieldId: FIELD.link,
            foreignTableId: TABLE_B,
            lookupFieldId: FIELD.partnerName,
          },
          cellValueType: 'string',
          isMultipleCellValue: true,
        },
        {
          id: FIELD.rollup,
          name: 'Zeta Secret Partner Total',
          type: 'rollup',
          options: { expression: 'sum({values})' },
          lookupOptions: {
            linkFieldId: FIELD.link,
            foreignTableId: TABLE_B,
            lookupFieldId: FIELD.partnerAmount,
          },
          cellValueType: 'number',
          isMultipleCellValue: false,
        },
        {
          id: FIELD.category,
          name: 'Zeta Secret Category',
          type: 'singleSelect',
          options: {
            choices: [{ id: 'choAAAAAAAAAAAAAAAA', name: SECRET_CHOICE_NAME, color: 'blue' }],
          },
        },
      ],
      views: [
        {
          id: 'viwAAAAAAAAAAAAAAAA',
          name: 'Zeta Secret Grid',
          type: 'grid',
          order: 0,
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: FIELD.partnerAmount, operator: 'is', value: SECRET_CELL_VALUE }],
          },
        },
      ],
    },
    {
      id: TABLE_B,
      name: SECRET_TABLE_NAME_B,
      fields: [
        {
          id: FIELD.partnerName,
          name: 'Zeta Partner Name',
          type: 'singleLineText',
          isPrimary: true,
        },
        { id: FIELD.partnerAmount, name: 'Zeta Partner Amount', type: 'number' },
      ],
      views: [],
    },
  ],
});
