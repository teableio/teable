import { describe, expect, it } from 'vitest';

import type { FormulaProfile } from './FormulaProfile';
import {
  buildOperationShape,
  buildSchemaComplexityProfile,
  buildStructuralProfile,
  SCHEMA_COMPLEXITY_BASIS,
  SCHEMA_COMPLEXITY_PROFILE_VERSION,
} from './ComplexityProfile';
import type {
  OperationDescriptor,
  SchemaComplexityEdge,
  SchemaComplexityField,
  SchemaComplexityProfile,
  SchemaOperationShapeProfile,
} from './ComplexityProfile';

const BASE_TABLE = 'tbl1';

const formulaProfile = (overrides: Partial<FormulaProfile> = {}): FormulaProfile => ({
  status: 'ok',
  astDepth: 1,
  astNodeCount: 1,
  parseTreeNodeCount: 1,
  referenceCount: 0,
  uniqueReferenceCount: 0,
  functionCalls: {},
  functionCallsByCategory: {},
  contextFree: true,
  recordContext: false,
  volatile: false,
  warnings: [],
  ...overrides,
});

const textField = (id: string, tableId: string = BASE_TABLE): SchemaComplexityField => ({
  id,
  tableId,
  type: 'text',
  isComputed: false,
});

const computedField = (
  id: string,
  options: {
    readonly tableId?: string;
    readonly formula?: FormulaProfile;
    readonly conditional?: boolean;
  } = {}
): SchemaComplexityField => ({
  id,
  tableId: options.tableId ?? BASE_TABLE,
  type: 'formula',
  isComputed: true,
  ...(options.formula === undefined ? {} : { formula: options.formula }),
  ...(options.conditional === true ? { conditional: true } : {}),
});

type EdgeOverrides = Partial<
  Pick<
    SchemaComplexityEdge,
    'fromTableId' | 'toTableId' | 'linkFieldId' | 'conditional' | 'conditionFieldIds'
  >
>;

const edge = (
  kind: SchemaComplexityEdge['kind'],
  fromFieldId: string,
  toFieldId: string,
  overrides: EdgeOverrides = {}
): SchemaComplexityEdge => ({
  fromFieldId,
  toFieldId,
  fromTableId: BASE_TABLE,
  toTableId: BASE_TABLE,
  kind,
  ...overrides,
});

const sameEdge = (
  fromFieldId: string,
  toFieldId: string,
  overrides: EdgeOverrides = {}
): SchemaComplexityEdge => edge('same_record', fromFieldId, toFieldId, overrides);

const crossEdge = (
  fromFieldId: string,
  toFieldId: string,
  overrides: EdgeOverrides = {}
): SchemaComplexityEdge => edge('cross_record', fromFieldId, toFieldId, overrides);

const operationOf = (profile: SchemaComplexityProfile): SchemaOperationShapeProfile => {
  const operation = profile.operation;
  if (operation === null) throw new Error('expected an operation shape');
  return operation;
};

const updateOperation = (
  changedFieldIds: ReadonlyArray<string>,
  overrides: Partial<OperationDescriptor> = {}
): OperationDescriptor => ({
  kind: 'update',
  tableId: BASE_TABLE,
  changedFieldIds,
  ...overrides,
});

const chainFields = (): ReadonlyArray<SchemaComplexityField> => [
  textField('fldA'),
  computedField('fldB'),
  computedField('fldC'),
];

const chainEdges = (): ReadonlyArray<SchemaComplexityEdge> => [
  sameEdge('fldA', 'fldB'),
  sameEdge('fldB', 'fldC'),
];

describe('buildSchemaComplexityProfile structural profile', () => {
  it('counts a linear dependency chain and measures depth in edges', () => {
    const profile = buildSchemaComplexityProfile({
      fields: chainFields(),
      edges: chainEdges(),
      completeness: 'complete',
    });

    expect(profile.version).toBe(SCHEMA_COMPLEXITY_PROFILE_VERSION);
    expect(profile.basis).toBe(SCHEMA_COMPLEXITY_BASIS);
    expect(profile.scope).toEqual({ focusTableId: null });
    expect(profile.operation).toBeNull();
    expect(profile.formulas).toEqual([]);
    expect(profile.structural).toMatchObject({
      completeness: 'complete',
      effectiveCompleteness: 'complete',
      fieldCount: 3,
      graphNodeCount: 3,
      focusTableFieldCount: null,
      computedFieldCount: 2,
      edgeCount: 2,
      sameRecordEdgeCount: 2,
      crossRecordEdgeCount: 0,
      conditionalFieldCount: 0,
      conditionalEdgeCount: 0,
      maxUniqueOutDegree: 1,
      maxUniqueInDegree: 1,
      maxDependencyDepth: 2,
      depthStatus: 'exact',
      cycleFieldIds: [],
      blockedFieldIds: [],
      unresolvedFieldIds: [],
    });
    expect(profile.evidence).toEqual({
      completeness: 'complete',
      dataPresence: 'unknown',
      beforeImage: null,
    });
    expect(profile).not.toHaveProperty('runtimeCost');
    expect(Object.prototype.hasOwnProperty.call(profile, 'score')).toBe(false);
  });
  it('defaults to partial completeness and only claims exact depth when declared', () => {
    const profile = buildSchemaComplexityProfile({
      fields: chainFields(),
      edges: chainEdges(),
    });

    expect(profile.structural).toMatchObject({
      completeness: 'partial',
      effectiveCompleteness: 'partial',
      depthStatus: 'partial',
      maxDependencyDepth: 2,
    });
  });

  it('does not report lookup or rollup fields as missing formula sources', () => {
    const fields = [
      textField('fldA'),
      computedField('fldFormula'),
      { id: 'fldLookup', tableId: BASE_TABLE, type: 'lookup', isComputed: true },
      { id: 'fldRollup', tableId: BASE_TABLE, type: 'rollup', isComputed: true },
    ];
    const profile = buildSchemaComplexityProfile({
      fields,
      edges: [],
      completeness: 'complete',
    });

    expect(profile.structural.missingMetadata.computedFieldsWithoutFormula).toEqual(['fldFormula']);
    expect(profile.warnings).toContain('computed-field-without-formula:fldFormula');
    expect(profile.warnings).not.toContain('computed-field-without-formula:fldLookup');
    expect(profile.warnings).not.toContain('computed-field-without-formula:fldRollup');
  });

  it('uses all supplied edges and reports unresolved endpoints for focus-scoped graphs', () => {
    const fields = [textField('fldA'), computedField('fldC', { tableId: 'tbl2' })];
    const edges = [
      sameEdge('fldA', 'fldExternal'),
      crossEdge('fldExternal', 'fldC', {
        fromTableId: BASE_TABLE,
        toTableId: 'tbl2',
        linkFieldId: 'fldLink',
      }),
    ];

    const profile = buildSchemaComplexityProfile({
      fields,
      edges,
      focusTableId: BASE_TABLE,
      operation: updateOperation(['fldA']),
      completeness: 'complete',
    });

    expect(profile.structural).toMatchObject({
      fieldCount: 2,
      graphNodeCount: 3,
      focusTableFieldCount: 1,
      edgeCount: 2,
      sameRecordEdgeCount: 1,
      crossRecordEdgeCount: 1,
      maxDependencyDepth: 2,
      effectiveCompleteness: 'partial',
      depthStatus: 'partial',
      unresolvedFieldIds: ['fldExternal'],
    });
    expect(profile.structural.missingMetadata.unresolvedEdgeEndpointCount).toBe(2);
    expect(profile.warnings).toContain('unresolved-edge-endpoint:fldExternal');

    const operation = operationOf(profile);
    expect(operation.schemaPotential.potentialSteps).toEqual([
      { tableId: 'tbl2', level: 2, fieldIds: ['fldC'] },
    ]);
    expect(operation.schemaPotential.potentialStepCount).toBe(1);
    expect(operation.propagationModeCounts).toEqual({
      sameRecord: 1,
      linkTraversal: 1,
      conditionalFiltered: 0,
      allTargetRecords: 0,
      backfill: 0,
    });
    expect(operation.riskFlags).toContain('unresolved-field-metadata');
  });

  it('reports conditional and missing metadata without inventing records', () => {
    const fields = [
      textField('fldA'),
      computedField('fldB', { conditional: true }),
      computedField('fldC', { tableId: 'tbl2' }),
    ];
    const edges = [
      sameEdge('fldA', 'fldB', { conditional: true }),
      crossEdge('fldA', 'fldC', { toTableId: 'tbl2' }),
    ];

    const profile = buildSchemaComplexityProfile({
      fields,
      edges,
      operation: updateOperation(['fldA']),
      completeness: 'complete',
    });

    expect(profile.structural.conditionalFieldCount).toBe(1);
    expect(profile.structural.conditionalEdgeCount).toBe(1);
    expect(profile.structural.missingMetadata).toMatchObject({
      computedFieldsWithoutFormula: ['fldB', 'fldC'],
      crossRecordEdgesWithoutLinkField: 1,
      conditionalEdgesWithoutConditionFieldIds: 1,
      tableMismatchedEdges: 0,
      duplicateEdgeCount: 0,
    });
    expect(profile.warnings).toContain('conditional-edge-without-condition-fields:fldA->fldB');
    expect(profile.warnings).toContain('cross-record-edge-without-link-field:fldA->fldC');

    const operation = operationOf(profile);
    expect(operation.riskFlags).toContain('missing-condition-metadata');
    expect(operation.riskFlags).toContain('missing-link-metadata');
    expect(operation.schemaPotential.potentialStepCount).toBe(2);
  });
});

describe('buildSchemaComplexityProfile operation shape', () => {
  it('builds deterministic same-record levels for an update', () => {
    const profile = buildSchemaComplexityProfile({
      fields: chainFields(),
      edges: chainEdges(),
      operation: updateOperation(['fldA', 'fldA'], { beforeImage: 'available' }),
      completeness: 'complete',
    });
    const operation = operationOf(profile);

    expect(operation.kind).toBe('update');
    expect(operation.changedFieldIds).toEqual(['fldA']);
    expect(operation.shapeSource).toBe('schema-potential');
    expect(operation.effectiveShapeSource).toBe('schema-potential');
    expect(operation.plannerShape).toBeNull();
    expect(operation.schemaPotential.potentialSteps).toEqual([
      { tableId: BASE_TABLE, level: 1, fieldIds: ['fldB'] },
      { tableId: BASE_TABLE, level: 2, fieldIds: ['fldC'] },
    ]);
    expect(operation.schemaPotential.potentialStepCount).toBe(2);
    expect(operation.schemaPotential.potentialLevelCount).toBe(2);
    expect(operation.schemaPotential.propagationPaths).toMatchObject([
      {
        fromFieldId: 'fldA',
        toFieldId: 'fldB',
        fromTableId: BASE_TABLE,
        toTableId: BASE_TABLE,
        mode: 'sameRecord',
        certainty: 'structural',
        origin: 'dependency',
      },
      {
        fromFieldId: 'fldB',
        toFieldId: 'fldC',
        fromTableId: BASE_TABLE,
        toTableId: BASE_TABLE,
        mode: 'sameRecord',
        certainty: 'structural',
        origin: 'dependency',
      },
    ]);
    expect(operation.propagationModeCounts).toEqual({
      sameRecord: 2,
      linkTraversal: 0,
      conditionalFiltered: 0,
      allTargetRecords: 0,
      backfill: 0,
    });
    expect(operation.riskFlags).toEqual([]);
    expect(operation.truncated).toBe(false);
    expect(profile.evidence.beforeImage).toBe('available');
  });

  it('uses link traversal for cross-table edges', () => {
    const profile = buildSchemaComplexityProfile({
      fields: [textField('fldA'), computedField('fldB', { tableId: 'tbl2' })],
      edges: [
        crossEdge('fldA', 'fldB', {
          toTableId: 'tbl2',
          linkFieldId: 'fldLink',
        }),
      ],
      operation: updateOperation(['fldA']),
      completeness: 'complete',
    });
    const operation = operationOf(profile);

    expect(operation.schemaPotential.potentialSteps).toEqual([
      { tableId: 'tbl2', level: 1, fieldIds: ['fldB'] },
    ]);
    expect(operation.schemaPotential.propagationPaths).toMatchObject([
      {
        fromFieldId: 'fldA',
        toFieldId: 'fldB',
        fromTableId: BASE_TABLE,
        toTableId: 'tbl2',
        mode: 'linkTraversal',
        certainty: 'structural',
        origin: 'dependency',
        reason: 'link-field:fldLink',
      },
    ]);
    expect(operation.propagationModeCounts.linkTraversal).toBe(1);
  });

  it('keeps possible all-target alternatives when the before image is unknown', () => {
    const profile = buildSchemaComplexityProfile({
      fields: [
        textField('fldA'),
        textField('fldCond'),
        computedField('fldB', { conditional: true }),
      ],
      edges: [
        sameEdge('fldA', 'fldB', {
          conditional: true,
          conditionFieldIds: ['fldCond'],
        }),
      ],
      operation: updateOperation(['fldA'], { beforeImage: 'unknown' }),
      completeness: 'complete',
    });
    const operation = operationOf(profile);
    const paths = operation.schemaPotential.propagationPaths;

    expect(paths).toHaveLength(2);
    expect(paths).toContainEqual(expect.objectContaining({
      fromFieldId: 'fldA',
      toFieldId: 'fldB',
      fromTableId: BASE_TABLE,
      toTableId: BASE_TABLE,
      mode: 'conditionalFiltered',
      certainty: 'possible',
      origin: 'dependency',
      reason: 'condition-fields:fldCond',
    }));
    expect(paths).toContainEqual(expect.objectContaining({
      fromFieldId: 'fldA',
      toFieldId: 'fldB',
      fromTableId: BASE_TABLE,
      toTableId: BASE_TABLE,
      mode: 'allTargetRecords',
      certainty: 'possible',
      origin: 'dependency',
      reason: 'before-image-unknown',
    }));
    expect(operation.propagationModeCounts).toEqual({
      sameRecord: 0,
      linkTraversal: 0,
      conditionalFiltered: 1,
      allTargetRecords: 1,
      backfill: 0,
    });
    expect(operation.riskFlags).toEqual([
      'conditional-all-target-possible',
      'conditional-before-image-unknown',
    ]);
    expect(operation.schemaPotential.riskFlags).toEqual([
      'conditional-all-target-possible',
      'conditional-before-image-unknown',
    ]);
  });

  it('treats conditional filtering as exact only when the before image is available', () => {
    const profile = buildSchemaComplexityProfile({
      fields: [
        textField('fldA'),
        textField('fldCond'),
        computedField('fldB', { conditional: true }),
      ],
      edges: [
        sameEdge('fldA', 'fldB', {
          conditional: true,
          conditionFieldIds: ['fldCond'],
        }),
      ],
      operation: updateOperation(['fldA'], { beforeImage: 'available' }),
      completeness: 'complete',
    });
    const operation = operationOf(profile);

    expect(operation.schemaPotential.propagationPaths).toMatchObject([
      {
        fromFieldId: 'fldA',
        toFieldId: 'fldB',
        fromTableId: BASE_TABLE,
        toTableId: BASE_TABLE,
        mode: 'conditionalFiltered',
        certainty: 'structural',
        origin: 'dependency',
        reason: 'condition-fields:fldCond',
      },
    ]);
    expect(operation.propagationModeCounts.allTargetRecords).toBe(0);
    expect(operation.riskFlags).toEqual([]);
  });

  it('seeds context-free formulas on update without reaching referenced formulas', () => {
    const contextFree = formulaProfile({ contextFree: true });
    const recordDependent = formulaProfile({ contextFree: false, referenceCount: 1 });
    const fields = [
      textField('fldA'),
      computedField('fldF', { formula: contextFree }),
      computedField('fldG', { formula: recordDependent }),
    ];
    const profile = buildSchemaComplexityProfile({
      fields,
      edges: [],
      operation: updateOperation(['fldA']),
      completeness: 'complete',
    });
    const operation = operationOf(profile);

    expect(operation.schemaPotential.potentialSteps).toEqual([
      { tableId: BASE_TABLE, level: 0, fieldIds: ['fldF'] },
    ]);
    expect(operation.schemaPotential.potentialStepCount).toBe(1);
    expect(operation.schemaPotential.potentialFieldCount).toBe(1);
    expect(operation.schemaPotential.potentialLevelCount).toBe(1);
    expect(operation.schemaPotential.propagationPaths).toMatchObject([]);
    expect(operation.contextFreeFormulaFieldIds).toEqual(['fldF']);
    expect(operation.riskFlags).toEqual([]);
    expect(profile.formulas).toEqual([
      { fieldId: 'fldF', tableId: BASE_TABLE, profile: contextFree },
      { fieldId: 'fldG', tableId: BASE_TABLE, profile: recordDependent },
    ]);
  });

  it('keeps real dependency levels when inserting every computed field', () => {
    const fields = [
      textField('fldA'),
      computedField('fldB'),
      computedField('fldC', { formula: formulaProfile({ contextFree: true }) }),
    ];
    const profile = buildSchemaComplexityProfile({
      fields,
      edges: [sameEdge('fldA', 'fldB'), sameEdge('fldB', 'fldC')],
      operation: { kind: 'create', tableId: BASE_TABLE, changedFieldIds: [] },
      completeness: 'complete',
    });
    const operation = operationOf(profile);

    expect(operation.schemaPotential.potentialSteps).toEqual([
      { tableId: BASE_TABLE, level: 1, fieldIds: ['fldB'] },
      { tableId: BASE_TABLE, level: 2, fieldIds: ['fldC'] },
    ]);
    expect(operation.schemaPotential.potentialStepCount).toBe(2);
    expect(operation.schemaPotential.potentialFieldCount).toBe(2);
    expect(operation.schemaPotential.potentialLevelCount).toBe(2);
    expect(operation.riskFlags).toEqual([]);
  });

  it('seeds context-free formulas for create and update', () => {
    const fields = [
      textField('fldA'),
      computedField('fldF', { formula: formulaProfile({ contextFree: true }) }),
    ];
    const createProfile = buildSchemaComplexityProfile({
      fields,
      edges: [],
      operation: { kind: 'create', tableId: BASE_TABLE, changedFieldIds: ['fldA'] },
      completeness: 'complete',
    });
    const updateProfile = buildSchemaComplexityProfile({
      fields,
      edges: [],
      operation: updateOperation(['fldA']),
      completeness: 'complete',
    });

    const createOperation = operationOf(createProfile);
    const updateOperationShape = operationOf(updateProfile);

    expect(createOperation.schemaPotential.potentialSteps).toEqual([
      { tableId: BASE_TABLE, level: 0, fieldIds: ['fldF'] },
    ]);
    expect(createOperation.schemaPotential.potentialStepCount).toBe(1);
    expect(createOperation.contextFreeFormulaFieldIds).toEqual(['fldF']);
    expect(createOperation.riskFlags).toEqual([]);

    expect(updateOperationShape.schemaPotential.potentialSteps).toEqual([
      { tableId: BASE_TABLE, level: 0, fieldIds: ['fldF'] },
    ]);
    expect(updateOperationShape.riskFlags).toEqual([]);
    expect(updateOperationShape.pasteMode).toBeNull();
  });
  it('seeds paste insert/mixed computed values but not a paste update', () => {
    const fields = [
      textField('fldA'),
      computedField('fldF', { formula: formulaProfile({ contextFree: true }) }),
      { id: 'fldLookup', tableId: BASE_TABLE, type: 'lookup', isComputed: true },
    ];
    const buildPaste = (pasteMode?: 'insert' | 'update' | 'mixed') =>
      buildSchemaComplexityProfile({
        fields,
        edges: [],
        operation: {
          kind: 'paste',
          tableId: BASE_TABLE,
          changedFieldIds: ['fldA'],
          ...(pasteMode === undefined ? {} : { pasteMode }),
        },
        completeness: 'complete',
      });

    const insert = operationOf(buildPaste('insert'));
    const mixed = operationOf(buildPaste('mixed'));
    const update = operationOf(buildPaste('update'));
    const unknown = buildPaste();

    expect(insert.pasteMode).toBe('insert');
    expect(insert.schemaPotential.potentialSteps).toEqual([
      { tableId: BASE_TABLE, level: 0, fieldIds: ['fldF', 'fldLookup'] },
    ]);
    expect(insert.schemaPotential.potentialStepCount).toBe(1);
    expect(insert.schemaPotential.potentialFieldCount).toBe(2);
    expect(mixed.pasteMode).toBe('mixed');
    expect(mixed.schemaPotential.potentialFieldCount).toBe(2);
    expect(update.pasteMode).toBe('update');
    expect(update.schemaPotential.potentialSteps).toEqual([
      { tableId: BASE_TABLE, level: 0, fieldIds: ['fldF'] },
    ]);
    expect(unknown.warnings).toContain('paste-without-paste-mode');
  });

  it('keeps backfill paths on conditional field-change edges', () => {
    const fields = [
      textField('fldA'),
      textField('fldCond'),
      computedField('fldB', { conditional: true }),
    ];
    const edges = [
      sameEdge('fldA', 'fldB', {
        conditional: true,
        conditionFieldIds: ['fldCond'],
      }),
    ];
    const profile = buildSchemaComplexityProfile({
      fields,
      edges,
      operation: {
        kind: 'field-change',
        fieldChange: 'create',
        tableId: BASE_TABLE,
        changedFieldIds: ['fldA'],
        beforeImage: 'available',
      },
      completeness: 'complete',
    });
    const operation = operationOf(profile);
    const modes = operation.schemaPotential.propagationPaths.map((path) => path.mode);

    expect(modes).toEqual(['backfill', 'conditionalFiltered']);
    expect(operation.propagationModeCounts).toEqual({
      sameRecord: 0,
      linkTraversal: 0,
      conditionalFiltered: 1,
      allTargetRecords: 0,
      backfill: 1,
    });
  });

  it('flags an update with no changed fields as empty', () => {
    const profile = buildSchemaComplexityProfile({
      fields: chainFields(),
      edges: chainEdges(),
      operation: updateOperation([]),
    });
    const operation = operationOf(profile);

    expect(operation.changedFieldIds).toEqual([]);
    expect(operation.schemaPotential.potentialSteps).toEqual([]);
    expect(operation.schemaPotential.propagationPaths).toMatchObject([]);
    expect(operation.riskFlags).toContain('empty-changed-fields');
  });

  it('models backfill only for create and update field changes', () => {
    const fields = [textField('fldA'), computedField('fldF'), computedField('fldB')];
    const edges = [sameEdge('fldF', 'fldB'), sameEdge('fldA', 'fldB')];
    const createFieldChange = buildSchemaComplexityProfile({
      fields,
      edges,
      operation: {
        kind: 'field-change',
        tableId: BASE_TABLE,
        changedFieldIds: ['fldF'],
        fieldChange: 'create',
      },
    });
    const updateFieldChange = buildSchemaComplexityProfile({
      fields,
      edges,
      operation: {
        kind: 'field-change',
        tableId: BASE_TABLE,
        changedFieldIds: ['fldF'],
        fieldChange: 'update',
      },
    });
    const plainUpdate = buildSchemaComplexityProfile({
      fields,
      edges,
      operation: updateOperation(['fldF']),
    });

    const createOperation = operationOf(createFieldChange);
    const updateOperationShape = operationOf(updateFieldChange);
    const plainUpdateOperation = operationOf(plainUpdate);

    expect(createOperation.schemaPotential.potentialSteps).toEqual([
      { tableId: BASE_TABLE, level: 0, fieldIds: ['fldF'] },
      { tableId: BASE_TABLE, level: 1, fieldIds: ['fldB'] },
    ]);
    expect(createOperation.schemaPotential.propagationPaths).toContainEqual(
      expect.objectContaining({
        fromFieldId: 'fldF',
        toFieldId: 'fldB',
        fromTableId: BASE_TABLE,
        toTableId: BASE_TABLE,
        mode: 'backfill',
        certainty: 'structural',
        origin: 'dependency',
        reason: 'field-change-create-backfill',
      })
    );
    expect(createOperation.schemaPotential.propagationPaths).toContainEqual(expect.objectContaining({
      fromFieldId: 'fldF',
      toFieldId: 'fldF',
      fromTableId: BASE_TABLE,
      toTableId: BASE_TABLE,
      mode: 'backfill',
      certainty: 'structural',
      origin: 'field-backfill',
      reason: 'field-change-create-self-backfill',
      sourceFieldIds: ['fldF'],
      targetFieldIds: ['fldF'],
      sourceFieldCount: 1,
      targetFieldCount: 1,
    }));
    expect(createOperation.propagationModeCounts.backfill).toBe(2);
    expect(updateOperationShape.schemaPotential.propagationPaths).toContainEqual(expect.objectContaining({
      fromFieldId: 'fldF',
      toFieldId: 'fldB',
      fromTableId: BASE_TABLE,
      toTableId: BASE_TABLE,
      mode: 'backfill',
      certainty: 'structural',
      origin: 'dependency',
      reason: 'field-change-update-backfill',
    }));
    expect(updateOperationShape.schemaPotential.propagationPaths).toContainEqual(expect.objectContaining({
      fromFieldId: 'fldF',
      toFieldId: 'fldF',
      fromTableId: BASE_TABLE,
      toTableId: BASE_TABLE,
      mode: 'backfill',
      certainty: 'structural',
      origin: 'field-backfill',
      reason: 'field-change-update-self-backfill',
      sourceFieldIds: ['fldF'],
      targetFieldIds: ['fldF'],
      sourceFieldCount: 1,
      targetFieldCount: 1,
    }));
    expect(updateOperationShape.propagationModeCounts.backfill).toBe(2);
    expect(plainUpdateOperation.schemaPotential.propagationPaths).toContainEqual(expect.objectContaining({
      fromFieldId: 'fldF',
      toFieldId: 'fldB',
      fromTableId: BASE_TABLE,
      toTableId: BASE_TABLE,
      mode: 'sameRecord',
      certainty: 'structural',
      origin: 'dependency',
    }));
    expect(plainUpdateOperation.propagationModeCounts.backfill).toBe(0);
  });

  it('counts a conditional target self-backfill without faking upstream backfill', () => {
    const fields = [
      textField('fldA'),
      textField('fldCond'),
      computedField('fldB', { conditional: true }),
    ];
    const edges = [
      sameEdge('fldA', 'fldB', {
        conditional: true,
        conditionFieldIds: ['fldCond'],
      }),
    ];
    const buildTargetChange = (fieldChange: 'create' | 'update') =>
      buildSchemaComplexityProfile({
        fields,
        edges,
        operation: {
          kind: 'field-change',
          fieldChange,
          tableId: BASE_TABLE,
          changedFieldIds: ['fldB'],
          beforeImage: 'unknown',
        },
        completeness: 'complete',
      });

    for (const fieldChange of ['create', 'update'] as const) {
      const operation = operationOf(buildTargetChange(fieldChange));
      expect(operation.schemaPotential.potentialSteps).toEqual([
        { tableId: BASE_TABLE, level: 0, fieldIds: ['fldB'] },
      ]);
      expect(operation.schemaPotential.propagationPaths).toMatchObject([
        {
          fromFieldId: 'fldB',
          toFieldId: 'fldB',
          fromTableId: BASE_TABLE,
          toTableId: BASE_TABLE,
          mode: 'backfill',
          certainty: 'structural',
          origin: 'field-backfill',
          reason: `field-change-${fieldChange}-self-backfill`,
          sourceFieldIds: ['fldB'],
          targetFieldIds: ['fldB'],
          sourceFieldCount: 1,
          targetFieldCount: 1,
        },
      ]);
      expect(operation.schemaPotential.propagationPaths).not.toContainEqual(
        expect.objectContaining({ fromFieldId: 'fldA', toFieldId: 'fldB' })
      );
      expect(operation.propagationModeCounts).toEqual({
        sameRecord: 0,
        linkTraversal: 0,
        conditionalFiltered: 0,
        allTargetRecords: 0,
        backfill: 1,
      });
      expect(operation.riskFlags).toContain('conditional-target-backfill');
      expect(operation.riskFlags).not.toContain('conditional-all-target-possible');
      expect(operation.riskFlags).not.toContain('conditional-before-image-unknown');
    }
  });

  it('marks delete schema potential unavailable without backfilling a deleted field', () => {
    const fields = [textField('fldA'), computedField('fldB')];
    const edges = [sameEdge('fldA', 'fldB')];
    const deleteProfile = buildSchemaComplexityProfile({
      fields,
      edges,
      operation: { kind: 'delete', tableId: BASE_TABLE, changedFieldIds: ['fldA'] },
    });
    const deleteFieldProfile = buildSchemaComplexityProfile({
      fields,
      edges,
      operation: {
        kind: 'field-change',
        tableId: BASE_TABLE,
        changedFieldIds: ['fldB'],
        fieldChange: 'delete',
      },
    });

    const deleteOperation = operationOf(deleteProfile);
    const deleteFieldOperation = operationOf(deleteFieldProfile);

    expect(deleteOperation.schemaPotential.potentialSteps).toEqual([]);
    expect(deleteOperation.schemaPotential.propagationPaths).toMatchObject([]);
    expect(deleteOperation.riskFlags).toContain('record-delete-schema-potential-unavailable');

    expect(deleteFieldOperation.schemaPotential.potentialSteps).toEqual([]);
    expect(deleteFieldOperation.schemaPotential.propagationPaths).toMatchObject([]);
    expect(deleteFieldOperation.propagationModeCounts.backfill).toBe(0);
    expect(deleteFieldOperation.riskFlags).toContain('field-delete-no-backfill');
    expect(
      deleteFieldOperation.schemaPotential.potentialSteps.some((step) =>
        step.fieldIds.includes('fldB')
      )
    ).toBe(false);
  });

  it('separates cycle members from downstream blocked fields', () => {
    const fields = [computedField('fldA'), computedField('fldB'), computedField('fldC')];
    const edges = [sameEdge('fldA', 'fldB'), sameEdge('fldB', 'fldA'), sameEdge('fldB', 'fldC')];
    const profile = buildSchemaComplexityProfile({
      fields,
      edges,
      operation: updateOperation(['fldA']),
      completeness: 'complete',
    });
    const operation = operationOf(profile);

    expect(profile.structural.maxDependencyDepth).toBeNull();
    expect(profile.structural.depthStatus).toBe('cycle');
    expect(profile.structural.cycleFieldIds).toEqual(['fldA', 'fldB']);
    expect(profile.structural.blockedFieldIds).toEqual(['fldC']);

    expect(operation.schemaPotential.potentialSteps).toEqual([]);
    expect(operation.schemaPotential.blockedComputedFieldIds).toEqual(['fldA', 'fldB', 'fldC']);
    expect(operation.riskFlags).toContain('dependency-cycle');
    expect(operation.schemaPotential.propagationPaths).toHaveLength(3);
    expect(operation.truncated).toBe(false);
  });

  it('truncates depth-bounded traversal and keeps lower levels', () => {
    const profile = buildSchemaComplexityProfile({
      fields: chainFields(),
      edges: chainEdges(),
      operation: updateOperation(['fldA']),
      maxTraversalDepth: 1,
    });
    const operation = operationOf(profile);

    expect(operation.schemaPotential.potentialSteps).toEqual([
      { tableId: BASE_TABLE, level: 1, fieldIds: ['fldB'] },
    ]);
    expect(operation.schemaPotential.truncatedFieldIds).toEqual(['fldC']);
    expect(operation.schemaPotential.propagationPaths).toHaveLength(1);
    expect(operation.schemaPotential.truncated).toBe(true);
    expect(operation.truncated).toBe(true);
    expect(operation.riskFlags).toContain('traversal-truncated');
  });

  it('propagates schema truncation into the operation shape', () => {
    const profile = buildSchemaComplexityProfile({
      fields: chainFields(),
      edges: chainEdges(),
      completeness: 'truncated',
      operation: updateOperation(['fldA']),
    });
    const operation = operationOf(profile);

    expect(profile.structural.maxDependencyDepth).toBeNull();
    expect(profile.structural.depthStatus).toBe('truncated');
    expect(profile.structural.effectiveCompleteness).toBe('truncated');
    expect(operation.schemaPotential.potentialStepCount).toBe(2);
    expect(operation.riskFlags).toContain('schema-truncated');
    expect(operation.truncated).toBe(true);
  });

  it('preserves planner projection separately from schema potential', () => {
    const fields = [
      textField('fldA'),
      textField('fldCond'),
      computedField('fldB', { conditional: true }),
    ];
    const edges = [
      sameEdge('fldA', 'fldB', {
        conditional: true,
        conditionFieldIds: ['fldCond'],
      }),
    ];
    const profile = buildSchemaComplexityProfile({
      fields,
      edges,
      completeness: 'complete',
      operation: {
        kind: 'update',
        tableId: BASE_TABLE,
        changedFieldIds: ['fldA'],
        plan: {
          steps: [{ tableId: BASE_TABLE, fieldIds: ['fldB'], level: 1 }],
          paths: [
            {
              fromFieldId: 'fldA',
              toFieldId: 'fldB',
              fromTableId: BASE_TABLE,
              toTableId: BASE_TABLE,
              mode: 'conditionalFiltered',
              reason: 'planner-filter',
            },
          ],
          seedAllTableIds: [BASE_TABLE, BASE_TABLE],
          cycle: false,
          truncated: true,
          beforeImage: 'available',
        },
      },
    });
    const operation = operationOf(profile);
    const plannerShape = operation.plannerShape;

    expect(operation.schemaPotential.propagationPaths).toHaveLength(2);
    expect(operation.schemaPotential.riskFlags).toContain('conditional-before-image-unknown');
    expect(plannerShape).not.toBeNull();
    expect(plannerShape?.steps).toEqual([{ tableId: BASE_TABLE, fieldIds: ['fldB'], level: 1 }]);
    expect(plannerShape?.potentialStepCount).toBe(1);
    expect(plannerShape?.potentialFieldCount).toBe(1);
    expect(plannerShape?.propagationPaths).toMatchObject([
      {
        fromFieldId: 'fldA',
        toFieldId: 'fldB',
        fromTableId: BASE_TABLE,
        toTableId: BASE_TABLE,
        mode: 'conditionalFiltered',
        certainty: 'structural',
        origin: 'dependency',
        reason: 'planner-filter',
      },
    ]);
    expect(plannerShape?.seedAllTableIds).toEqual([BASE_TABLE]);
    expect(plannerShape?.cycle).toBe(false);
    expect(plannerShape?.truncated).toBe(true);
    expect(plannerShape?.beforeImage).toBe('available');
    expect(plannerShape?.riskFlags).toEqual(['planner-seed-all-tables', 'planner-shape-truncated']);
    expect(operation.effectiveShapeSource).toBe('planner');
    expect(operation.propagationModeCounts).toEqual({
      sameRecord: 0,
      linkTraversal: 0,
      conditionalFiltered: 1,
      allTargetRecords: 0,
      backfill: 0,
    });
    expect(operation.riskFlags).toEqual(['planner-seed-all-tables', 'planner-shape-truncated']);
    expect(operation.riskFlags).not.toContain('conditional-before-image-unknown');
    expect(operation.truncated).toBe(true);
    expect(profile.evidence.beforeImage).toBe('available');
  });

  it('falls back invalid planner path origin to dependency with a warning', () => {
    const profile = buildSchemaComplexityProfile({
      fields: chainFields(),
      edges: chainEdges(),
      completeness: 'complete',
      operation: updateOperation(['fldA'], {
        plan: {
          steps: [{ tableId: BASE_TABLE, fieldIds: ['fldB'], level: 1 }],
          paths: [
            {
              fromFieldId: 'fldA',
              toFieldId: 'fldB',
              fromTableId: BASE_TABLE,
              toTableId: BASE_TABLE,
              mode: 'linkTraversal',
              origin: 'invalid' as never,
            },
          ],
          beforeImage: 'unknown',
        },
      }),
    });

    expect(profile.warnings).toContain('invalid-planner-path-origin:invalid');
    expect(operationOf(profile).plannerShape?.propagationPaths[0]?.origin).toBe('dependency');
  });

  it('keeps empty data as an evidence marker rather than zero counts', () => {
    const profile = buildSchemaComplexityProfile({
      fields: chainFields(),
      edges: chainEdges(),
      operation: updateOperation(['fldA'], {
        beforeImage: 'available',
        dataPresence: 'empty',
      }),
    });
    const operation = operationOf(profile);

    expect(profile.evidence.dataPresence).toBe('empty');
    expect(operation.schemaPotential.potentialStepCount).toBe(2);
    expect(operation.schemaPotential.propagationPaths).toHaveLength(2);
  });
});

describe('buildSchemaComplexityProfile determinism', () => {
  it('sorts and deduplicates duplicate inputs deterministically', () => {
    const fieldsA: ReadonlyArray<SchemaComplexityField> = [
      textField('fldA'),
      computedField('fldB'),
      computedField('fldC'),
      textField('fldA'),
    ];
    const fieldsB: ReadonlyArray<SchemaComplexityField> = [
      textField('fldA'),
      computedField('fldC'),
      textField('fldA'),
      computedField('fldB'),
    ];
    const edgesA: ReadonlyArray<SchemaComplexityEdge> = [
      sameEdge('fldA', 'fldB'),
      sameEdge('fldA', 'fldB'),
      sameEdge('fldB', 'fldC'),
    ];
    const edgesB: ReadonlyArray<SchemaComplexityEdge> = [
      sameEdge('fldB', 'fldC'),
      sameEdge('fldA', 'fldB'),
      sameEdge('fldA', 'fldB'),
    ];
    const snapshotFields = JSON.stringify(fieldsA);
    const snapshotEdges = JSON.stringify(edgesA);

    const profileA = buildSchemaComplexityProfile({
      fields: fieldsA,
      edges: edgesA,
      operation: updateOperation(['fldA', 'fldA']),
      completeness: 'complete',
    });
    const profileB = buildSchemaComplexityProfile({
      fields: fieldsB,
      edges: edgesB,
      operation: updateOperation(['fldA']),
      completeness: 'complete',
    });

    expect(profileA).toEqual(profileB);
    expect(profileA.structural.fieldCount).toBe(3);
    expect(profileA.structural.edgeCount).toBe(2);
    expect(profileA.structural.missingMetadata.duplicateEdgeCount).toBe(1);
    expect(profileA.warnings).toContain('duplicate-field-id:fldA');
    expect(profileA.warnings).toContain('duplicate-edge:fldA->fldB');
    expect(profileA.warnings).toEqual([...profileA.warnings].sort());
    expect(operationOf(profileA).changedFieldIds).toEqual(['fldA']);
    expect(JSON.stringify(fieldsA)).toBe(snapshotFields);
    expect(JSON.stringify(edgesA)).toBe(snapshotEdges);
  });

  it('exports standalone structural and operation builders', () => {
    const fields = chainFields();
    const edges = chainEdges();
    const operation = updateOperation(['fldA']);

    const structural = buildStructuralProfile({
      fields,
      edges,
      focusTableId: BASE_TABLE,
    });
    const operationShape = buildOperationShape({ fields, edges, operation });
    const profile = buildSchemaComplexityProfile({
      fields,
      edges,
      operation,
      focusTableId: BASE_TABLE,
    });

    expect(structural).toEqual(profile.structural);
    expect(operationShape).toEqual(profile.operation);
  });
});
