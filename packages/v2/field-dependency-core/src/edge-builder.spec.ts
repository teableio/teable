import { describe, expect, it } from 'vitest';

import {
  buildConditionalEdges,
  buildDerivedEdges,
  buildDerivedEdgesFromField,
  buildLinkEdges,
  buildLookupEdges,
  buildRollupEdges,
  mergeEdges,
} from './edge-builder';
import type {
  FieldDependencyEdge,
  FieldMeta,
  ParsedLookupOptions,
  ParsedLinkOptions,
  ParsedConditionalOptions,
} from './types';

describe('edge-builder', () => {
  describe('buildLookupEdges', () => {
    it('creates two edges for lookup field', () => {
      const options: ParsedLookupOptions = {
        linkFieldId: 'fldLink',
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldSource',
      };

      const edges = buildLookupEdges('fldLookup', 'tblLocal', options);

      expect(edges).toHaveLength(2);

      // lookup_link edge (same-record)
      const linkEdge = edges.find((e) => e.semantic === 'lookup_link');
      expect(linkEdge).toEqual({
        fromFieldId: 'fldLink',
        toFieldId: 'fldLookup',
        fromTableId: 'tblLocal',
        toTableId: 'tblLocal',
        kind: 'same_record',
        semantic: 'lookup_link',
      });

      // lookup_source edge (cross-record)
      const sourceEdge = edges.find((e) => e.semantic === 'lookup_source');
      expect(sourceEdge).toEqual({
        fromFieldId: 'fldSource',
        toFieldId: 'fldLookup',
        fromTableId: 'tblForeign',
        toTableId: 'tblLocal',
        kind: 'cross_record',
        linkFieldId: 'fldLink',
        semantic: 'lookup_source',
      });
    });
  });

  describe('buildRollupEdges', () => {
    it('creates two edges for rollup field', () => {
      const options: ParsedLookupOptions = {
        linkFieldId: 'fldLink',
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldSource',
      };

      const edges = buildRollupEdges('fldRollup', 'tblLocal', options);

      expect(edges).toHaveLength(2);

      // lookup_link edge
      const linkEdge = edges.find((e) => e.semantic === 'lookup_link');
      expect(linkEdge?.kind).toBe('same_record');

      // rollup_source edge
      const sourceEdge = edges.find((e) => e.semantic === 'rollup_source');
      expect(sourceEdge?.kind).toBe('cross_record');
      expect(sourceEdge?.linkFieldId).toBe('fldLink');
    });
  });

  describe('buildLinkEdges', () => {
    it('creates link_title edge for link field', () => {
      const options: ParsedLinkOptions = {
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldPrimary',
      };

      const edges = buildLinkEdges('fldLink', 'tblLocal', options);

      expect(edges).toHaveLength(1);
      expect(edges[0]).toEqual({
        fromFieldId: 'fldPrimary',
        toFieldId: 'fldLink',
        fromTableId: 'tblForeign',
        toTableId: 'tblLocal',
        kind: 'cross_record',
        linkFieldId: 'fldLink',
        semantic: 'link_title',
      });
    });
  });

  describe('buildConditionalEdges', () => {
    it('creates edges for conditionalRollup', () => {
      const options: ParsedConditionalOptions = {
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldSource',
        conditionFieldIds: ['fldCond1', 'fldCond2'],
      };

      const edges = buildConditionalEdges(
        'fldCondRollup',
        'tblLocal',
        'conditionalRollup',
        options
      );

      // Should have 3 edges: lookupField + 2 condition fields
      expect(edges).toHaveLength(3);

      // All edges should have conditional_rollup_source semantic
      expect(edges.every((e) => e.semantic === 'conditional_rollup_source')).toBe(true);

      // All edges should be cross_record
      expect(edges.every((e) => e.kind === 'cross_record')).toBe(true);

      // Check field IDs
      const fromFieldIds = edges.map((e) => e.fromFieldId);
      expect(fromFieldIds).toContain('fldSource');
      expect(fromFieldIds).toContain('fldCond1');
      expect(fromFieldIds).toContain('fldCond2');
    });

    it('creates edges for conditionalLookup', () => {
      const options: ParsedConditionalOptions = {
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldSource',
        conditionFieldIds: [],
      };

      const edges = buildConditionalEdges(
        'fldCondLookup',
        'tblLocal',
        'conditionalLookup',
        options
      );

      expect(edges).toHaveLength(1);
      expect(edges[0].semantic).toBe('conditional_lookup_source');
    });

    it('skips duplicate condition field if same as lookup field', () => {
      const options: ParsedConditionalOptions = {
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldSource',
        conditionFieldIds: ['fldSource', 'fldOther'], // fldSource is duplicate
      };

      const edges = buildConditionalEdges(
        'fldCondRollup',
        'tblLocal',
        'conditionalRollup',
        options
      );

      // Should have 2 edges (not 3), because fldSource is already the lookup field
      expect(edges).toHaveLength(2);
    });
  });

  describe('buildDerivedEdgesFromField', () => {
    it('builds edges for lookup field', () => {
      const field: FieldMeta = {
        id: 'fldLookup',
        tableId: 'tblLocal',
        type: 'lookup',
        isComputed: true,
        isLookup: true,
        lookupOptions: {
          linkFieldId: 'fldLink',
          foreignTableId: 'tblForeign',
          lookupFieldId: 'fldSource',
        },
        options: null,
        conditionalOptions: null,
      };

      const edges = buildDerivedEdgesFromField(field);
      expect(edges).toHaveLength(2);
      expect(edges.some((e) => e.semantic === 'lookup_link')).toBe(true);
      expect(edges.some((e) => e.semantic === 'lookup_source')).toBe(true);
    });

    it('builds edges for rollup field', () => {
      const field: FieldMeta = {
        id: 'fldRollup',
        tableId: 'tblLocal',
        type: 'rollup',
        isComputed: true,
        isLookup: false,
        lookupOptions: {
          linkFieldId: 'fldLink',
          foreignTableId: 'tblForeign',
          lookupFieldId: 'fldSource',
        },
        options: null,
        conditionalOptions: null,
      };

      const edges = buildDerivedEdgesFromField(field);
      expect(edges).toHaveLength(2);
      expect(edges.some((e) => e.semantic === 'rollup_source')).toBe(true);
    });

    it('builds edges for link field', () => {
      const field: FieldMeta = {
        id: 'fldLink',
        tableId: 'tblLocal',
        type: 'link',
        isComputed: false,
        isLookup: false,
        lookupOptions: null,
        options: {
          foreignTableId: 'tblForeign',
          lookupFieldId: 'fldPrimary',
        },
        conditionalOptions: null,
      };

      const edges = buildDerivedEdgesFromField(field);
      expect(edges).toHaveLength(1);
      expect(edges[0].semantic).toBe('link_title');
    });

    it('returns empty array for non-computed field', () => {
      const field: FieldMeta = {
        id: 'fldText',
        tableId: 'tblLocal',
        type: 'singleLineText',
        isComputed: false,
        isLookup: false,
        lookupOptions: null,
        options: null,
        conditionalOptions: null,
      };

      const edges = buildDerivedEdgesFromField(field);
      expect(edges).toHaveLength(0);
    });
  });

  describe('buildDerivedEdges', () => {
    it('builds edges for multiple fields', () => {
      const fields: FieldMeta[] = [
        {
          id: 'fldLookup',
          tableId: 'tblLocal',
          type: 'lookup',
          isComputed: true,
          isLookup: true,
          lookupOptions: {
            linkFieldId: 'fldLink',
            foreignTableId: 'tblForeign',
            lookupFieldId: 'fldSource',
          },
          options: null,
          conditionalOptions: null,
        },
        {
          id: 'fldText',
          tableId: 'tblLocal',
          type: 'singleLineText',
          isComputed: false,
          isLookup: false,
          lookupOptions: null,
          options: null,
          conditionalOptions: null,
        },
      ];

      const edges = buildDerivedEdges(fields);
      expect(edges).toHaveLength(2); // Only lookup field generates edges
    });
  });

  describe('mergeEdges', () => {
    it('combines reference and derived edges', () => {
      const referenceEdges: FieldDependencyEdge[] = [
        {
          fromFieldId: 'fld1',
          toFieldId: 'fld2',
          fromTableId: 'tbl1',
          toTableId: 'tbl1',
          kind: 'same_record',
          semantic: 'formula_ref',
        },
      ];

      const derivedEdges: FieldDependencyEdge[] = [
        {
          fromFieldId: 'fld3',
          toFieldId: 'fld4',
          fromTableId: 'tbl1',
          toTableId: 'tbl1',
          kind: 'same_record',
          semantic: 'lookup_link',
        },
      ];

      const merged = mergeEdges(referenceEdges, derivedEdges);
      expect(merged).toHaveLength(2);
    });

    it('deduplicates edges by key', () => {
      const referenceEdges: FieldDependencyEdge[] = [
        {
          fromFieldId: 'fld1',
          toFieldId: 'fld2',
          fromTableId: 'tbl1',
          toTableId: 'tbl1',
          kind: 'same_record',
          semantic: 'formula_ref',
        },
      ];

      const derivedEdges: FieldDependencyEdge[] = [
        {
          fromFieldId: 'fld1',
          toFieldId: 'fld2',
          fromTableId: 'tbl1',
          toTableId: 'tbl1',
          kind: 'same_record',
          semantic: 'lookup_link', // Different semantic but same key
        },
      ];

      const merged = mergeEdges(referenceEdges, derivedEdges);
      expect(merged).toHaveLength(1);
      // Derived edge should take priority
      expect(merged[0].semantic).toBe('lookup_link');
    });

    it('preserves edges with different linkFieldId', () => {
      const referenceEdges: FieldDependencyEdge[] = [];

      const derivedEdges: FieldDependencyEdge[] = [
        {
          fromFieldId: 'fldSource',
          toFieldId: 'fldLookup1',
          fromTableId: 'tblForeign',
          toTableId: 'tbl1',
          kind: 'cross_record',
          linkFieldId: 'fldLink1',
          semantic: 'lookup_source',
        },
        {
          fromFieldId: 'fldSource',
          toFieldId: 'fldLookup1',
          fromTableId: 'tblForeign',
          toTableId: 'tbl1',
          kind: 'cross_record',
          linkFieldId: 'fldLink2', // Different linkFieldId
          semantic: 'lookup_source',
        },
      ];

      const merged = mergeEdges(referenceEdges, derivedEdges);
      expect(merged).toHaveLength(2); // Both preserved due to different linkFieldId
    });

    it('preserves edges with different kind', () => {
      const referenceEdges: FieldDependencyEdge[] = [];

      const derivedEdges: FieldDependencyEdge[] = [
        {
          fromFieldId: 'fld1',
          toFieldId: 'fld2',
          fromTableId: 'tbl1',
          toTableId: 'tbl1',
          kind: 'same_record',
          semantic: 'formula_ref',
        },
        {
          fromFieldId: 'fld1',
          toFieldId: 'fld2',
          fromTableId: 'tbl1',
          toTableId: 'tbl1',
          kind: 'cross_record', // Different kind
          semantic: 'lookup_source',
        },
      ];

      const merged = mergeEdges(referenceEdges, derivedEdges);
      expect(merged).toHaveLength(2);
    });
  });
});
