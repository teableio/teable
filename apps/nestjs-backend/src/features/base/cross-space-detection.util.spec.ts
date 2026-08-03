import { FieldType } from '@teable/core';
import { describe, expect, it } from 'vitest';
import {
  collectCrossSpaceAffectedFieldIds,
  computeCrossSpaceFieldLevels,
  extractForeignTableId,
  parseFieldJson,
  sortByConversionDepth,
  type ICrossSpaceFieldInput,
} from './cross-space-detection.util';

const buildField = (overrides: Partial<ICrossSpaceFieldInput>): ICrossSpaceFieldInput => ({
  id: 'fld00000000000000',
  type: FieldType.SingleLineText,
  isLookup: null,
  isConditionalLookup: null,
  options: null,
  lookupOptions: null,
  ...overrides,
});

// Helper to model "every foreign table belongs to another space"
const allCrossSpace = (_ft: string) => true;
const allSameSpace = (_ft: string) => false;

describe('parseFieldJson', () => {
  it('parses JSON strings', () => {
    expect(parseFieldJson('{"foreignTableId":"tblX"}')).toEqual({ foreignTableId: 'tblX' });
  });

  it('returns objects as-is', () => {
    const o = { foreignTableId: 'tblX' };
    expect(parseFieldJson(o)).toBe(o);
  });

  it('returns undefined for null / empty / malformed', () => {
    expect(parseFieldJson(null)).toBeUndefined();
    expect(parseFieldJson(undefined)).toBeUndefined();
    expect(parseFieldJson('')).toBeUndefined();
    expect(parseFieldJson('not json')).toBeUndefined();
    expect(parseFieldJson(42)).toBeUndefined();
  });
});

describe('extractForeignTableId', () => {
  it('reads link options.foreignTableId', () => {
    expect(
      extractForeignTableId(
        buildField({
          type: FieldType.Link,
          options: { foreignTableId: 'tblForeign' },
        })
      )
    ).toBe('tblForeign');
  });

  it('skips link fields that are themselves lookups (downstream lookup, not the link)', () => {
    expect(
      extractForeignTableId(
        buildField({
          type: FieldType.Link,
          isLookup: true,
          options: { foreignTableId: 'tblForeign' },
        })
      )
    ).toBeUndefined();
  });

  it('reads conditionalLookup lookupOptions.foreignTableId (NOT options)', () => {
    expect(
      extractForeignTableId(
        buildField({
          type: FieldType.Formula,
          isLookup: true,
          isConditionalLookup: true,
          lookupOptions: { foreignTableId: 'tblForeign' },
          options: { foreignTableId: 'wrong' },
        })
      )
    ).toBe('tblForeign');
  });

  it('reads conditionalRollup options.foreignTableId', () => {
    expect(
      extractForeignTableId(
        buildField({
          type: FieldType.ConditionalRollup,
          options: { foreignTableId: 'tblForeign' },
        })
      )
    ).toBe('tblForeign');
  });

  it('returns undefined for plain rollup (no foreignTableId at top of options)', () => {
    // Rollup carries its foreign table indirectly via lookupOptions.linkFieldId
    expect(
      extractForeignTableId(
        buildField({
          type: FieldType.Rollup,
          options: { expression: 'sum({values})' },
          lookupOptions: { linkFieldId: 'fldLink', foreignTableId: 'tblForeign' },
        })
      )
    ).toBeUndefined();
  });

  it('handles JSON-string options', () => {
    expect(
      extractForeignTableId(
        buildField({
          type: FieldType.Link,
          options: JSON.stringify({ foreignTableId: 'tblForeign' }),
        })
      )
    ).toBe('tblForeign');
  });
});

describe('collectCrossSpaceAffectedFieldIds', () => {
  it('returns empty when no fields reference a foreign table', () => {
    const fields = [
      buildField({ id: 'fldA', type: FieldType.SingleLineText }),
      buildField({ id: 'fldB', type: FieldType.Number }),
    ];
    expect(
      collectCrossSpaceAffectedFieldIds({ fields, isForeignCrossSpace: allCrossSpace })
    ).toEqual(new Set());
  });

  it('flags a direct cross-space link field', () => {
    const fields = [
      buildField({
        id: 'fldLink',
        type: FieldType.Link,
        options: { foreignTableId: 'tblOtherSpace' },
      }),
    ];
    expect(
      collectCrossSpaceAffectedFieldIds({ fields, isForeignCrossSpace: allCrossSpace })
    ).toEqual(new Set(['fldLink']));
  });

  it('does not flag a same-space link field', () => {
    const fields = [
      buildField({
        id: 'fldLink',
        type: FieldType.Link,
        options: { foreignTableId: 'tblSameSpace' },
      }),
    ];
    expect(
      collectCrossSpaceAffectedFieldIds({ fields, isForeignCrossSpace: allSameSpace })
    ).toEqual(new Set());
  });

  it('flags conditional lookup whose lookupOptions.foreignTableId is cross-space', () => {
    const fields = [
      buildField({
        id: 'fldCondLookup',
        type: FieldType.Formula,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: { foreignTableId: 'tblOther' },
      }),
    ];
    expect(
      collectCrossSpaceAffectedFieldIds({ fields, isForeignCrossSpace: allCrossSpace })
    ).toEqual(new Set(['fldCondLookup']));
  });

  it('flags conditional rollup whose options.foreignTableId is cross-space', () => {
    const fields = [
      buildField({
        id: 'fldCondRollup',
        type: FieldType.ConditionalRollup,
        options: { foreignTableId: 'tblOther' },
      }),
    ];
    expect(
      collectCrossSpaceAffectedFieldIds({ fields, isForeignCrossSpace: allCrossSpace })
    ).toEqual(new Set(['fldCondRollup']));
  });

  it('flags a lookup that chains through a cross-space link (transitive)', () => {
    const fields = [
      buildField({
        id: 'fldLink',
        type: FieldType.Link,
        options: { foreignTableId: 'tblOther' },
      }),
      buildField({
        id: 'fldLookup',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: { linkFieldId: 'fldLink', foreignTableId: 'tblOther' },
      }),
    ];
    expect(
      collectCrossSpaceAffectedFieldIds({ fields, isForeignCrossSpace: allCrossSpace })
    ).toEqual(new Set(['fldLink', 'fldLookup']));
  });

  it('flags a rollup chaining through a cross-space link (transitive)', () => {
    const fields = [
      buildField({
        id: 'fldLink',
        type: FieldType.Link,
        options: { foreignTableId: 'tblOther' },
      }),
      buildField({
        id: 'fldRollup',
        type: FieldType.Rollup,
        lookupOptions: { linkFieldId: 'fldLink', foreignTableId: 'tblOther' },
        options: { expression: 'sum({values})' },
      }),
    ];
    expect(
      collectCrossSpaceAffectedFieldIds({ fields, isForeignCrossSpace: allCrossSpace })
    ).toEqual(new Set(['fldLink', 'fldRollup']));
  });

  it('handles a lookup whose linkFieldId targets another already-affected lookup (multi-hop)', () => {
    // Direct cross-space link
    // Lookup pointing at the link
    // Another lookup pointing at the first lookup (rare but observed in the wild)
    const fields = [
      buildField({
        id: 'fldLink',
        type: FieldType.Link,
        options: { foreignTableId: 'tblOther' },
      }),
      buildField({
        id: 'fldLookupA',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: { linkFieldId: 'fldLink' },
      }),
      buildField({
        id: 'fldLookupB',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: { linkFieldId: 'fldLookupA' },
      }),
    ];
    expect(
      collectCrossSpaceAffectedFieldIds({ fields, isForeignCrossSpace: allCrossSpace })
    ).toEqual(new Set(['fldLink', 'fldLookupA', 'fldLookupB']));
  });

  it('does not flag lookups chained through a same-space link', () => {
    const fields = [
      buildField({
        id: 'fldLink',
        type: FieldType.Link,
        options: { foreignTableId: 'tblSameSpace' },
      }),
      buildField({
        id: 'fldLookup',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: { linkFieldId: 'fldLink' },
      }),
    ];
    expect(
      collectCrossSpaceAffectedFieldIds({ fields, isForeignCrossSpace: allSameSpace })
    ).toEqual(new Set());
  });

  it('skips foreign tables marked internal (e.g. tables also being duplicated)', () => {
    const fields = [
      buildField({
        id: 'fldLink',
        type: FieldType.Link,
        options: { foreignTableId: 'tblInternal' },
      }),
    ];
    expect(
      collectCrossSpaceAffectedFieldIds({
        fields,
        isForeignInternal: (ft) => ft === 'tblInternal',
        isForeignCrossSpace: allCrossSpace, // would flag, but internal filter wins
      })
    ).toEqual(new Set());
  });

  it('does not flag fields when foreign table cannot be resolved (deleted / missing)', () => {
    const fields = [
      buildField({
        id: 'fldLink',
        type: FieldType.Link,
        options: { foreignTableId: 'tblDeleted' },
      }),
    ];
    expect(
      collectCrossSpaceAffectedFieldIds({
        fields,
        // Caller signals "unknown" by returning false (matches production semantics
        // where spaceMap.get() returns undefined for deleted/missing tables)
        isForeignCrossSpace: () => false,
      })
    ).toEqual(new Set());
  });

  it('mixes direct, transitive, and unrelated fields correctly', () => {
    const fields = [
      // Cross-space link
      buildField({
        id: 'fldCrossLink',
        type: FieldType.Link,
        options: { foreignTableId: 'tblOther' },
      }),
      // Same-space link (kept)
      buildField({
        id: 'fldSameLink',
        type: FieldType.Link,
        options: { foreignTableId: 'tblSame' },
      }),
      // Lookup of the cross-space link (flagged transitively)
      buildField({
        id: 'fldLookupCross',
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: { linkFieldId: 'fldCrossLink' },
      }),
      // Lookup of the same-space link (not flagged)
      buildField({
        id: 'fldLookupSame',
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: { linkFieldId: 'fldSameLink' },
      }),
      // Pure text field (not flagged)
      buildField({ id: 'fldText', type: FieldType.SingleLineText }),
      // Conditional lookup pointing across (flagged directly)
      buildField({
        id: 'fldCondLookup',
        type: FieldType.Formula,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: { foreignTableId: 'tblOther' },
      }),
    ];
    expect(
      collectCrossSpaceAffectedFieldIds({
        fields,
        isForeignCrossSpace: (ft) => ft === 'tblOther',
      })
    ).toEqual(new Set(['fldCrossLink', 'fldLookupCross', 'fldCondLookup']));
  });

  it('parses JSON-string options/lookupOptions (raw prisma shape)', () => {
    const fields = [
      buildField({
        id: 'fldLink',
        type: FieldType.Link,
        options: JSON.stringify({ foreignTableId: 'tblOther' }),
      }),
      buildField({
        id: 'fldLookup',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: JSON.stringify({ linkFieldId: 'fldLink' }),
      }),
    ];
    expect(
      collectCrossSpaceAffectedFieldIds({ fields, isForeignCrossSpace: allCrossSpace })
    ).toEqual(new Set(['fldLink', 'fldLookup']));
  });
});

describe('computeCrossSpaceFieldLevels', () => {
  it('assigns increasing depth across a multi-hop lookup chain regardless of input order', () => {
    // Input order intentionally shuffled to prove level depends on dependency
    // graph, not array position. Conversion order must run B(2) → A(1) → Link(0).
    const fields = [
      buildField({
        id: 'fldLookupB',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: { linkFieldId: 'fldLookupA' },
      }),
      buildField({
        id: 'fldLink',
        type: FieldType.Link,
        options: { foreignTableId: 'tblOther' },
      }),
      buildField({
        id: 'fldLookupA',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: { linkFieldId: 'fldLink' },
      }),
    ];
    const levels = computeCrossSpaceFieldLevels({ fields, isForeignCrossSpace: allCrossSpace });
    expect(levels.get('fldLink')).toBe(0);
    expect(levels.get('fldLookupA')).toBe(1);
    expect(levels.get('fldLookupB')).toBe(2);
  });

  it('does not loop on a malformed lookup cycle (neither side ever gets a level)', () => {
    // Cycle: A → B → A. Neither is directly cross-space and neither resolves
    // to a base case, so both stay unaffected (and the BFS terminates).
    const fields = [
      buildField({
        id: 'fldA',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: { linkFieldId: 'fldB' },
      }),
      buildField({
        id: 'fldB',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: { linkFieldId: 'fldA' },
      }),
    ];
    expect(computeCrossSpaceFieldLevels({ fields, isForeignCrossSpace: allCrossSpace })).toEqual(
      new Map()
    );
  });
});

describe('sortByConversionDepth', () => {
  it('orders rows deepest-first so dependent lookups convert before their link', () => {
    const rows = [{ fieldId: 'fldLink' }, { fieldId: 'fldLookupB' }, { fieldId: 'fldLookupA' }];
    const levels = new Map([
      ['fldLink', 0],
      ['fldLookupA', 1],
      ['fldLookupB', 2],
    ]);
    expect(sortByConversionDepth(rows, levels).map((r) => r.fieldId)).toEqual([
      'fldLookupB',
      'fldLookupA',
      'fldLink',
    ]);
  });
});
