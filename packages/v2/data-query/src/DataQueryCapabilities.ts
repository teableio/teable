import { FunctionName } from '@teable/v2-core';

import { dataQueryExpressionLimits } from './DataQueryExpression';

/** The canonical execution contract, shared by native schema/describe consumers. */
export const dataQueryCapabilities = {
  definitionVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  topN: {
    version: 9,
    kind: 'records',
    partitionKeys: { min: 1, max: 8 },
    orderKeys: { min: 1, max: 8 },
    limit: { min: 1, max: 1000 },
    keys: 'selectedOutputAliases',
    total: 'rankedRowsBeforePagination',
  },
  cursorPagination: {
    version: 7,
    kind: 'records',
    after: 'parameterReference',
    afterRequired: true,
    firstPage: 'omitRuntimeAfterParameter',
    nextCursor: 'opaqueOrNull',
    total: 'optionalBeforePagination',
    ordering: 'finalizedSortTupleAndRecordId',
  },
  recordsDistinct: {
    version: 6,
    flag: 'distinct: true',
    grain: 'selectedOutputTuple',
    sorting: 'projectedOutputs',
    textCollation: 'C',
    nulls: 'ascFirstDescLast',
    jsonEquality: 'structuralObjectsOrderedArrays',
    total: 'distinctTuplesBeforePagination',
  },
  distinctAggregate: {
    version: 8,
    statisticFunc: 'unique',
    input: 'distinctBy',
    maxKeys: 8,
    grain: 'outputGroup',
    equality: 'finalizedPublicValues',
    tupleNulls: 'nullComponentsParticipateIncludingAllNullRows',
    emptyInput: 0,
    missingRelationInput: 0,
    legacyScalarNulls: 'unchanged',
    relationInputs: 'sameSource',
  },
  relationExistence: {
    version: 5,
    context: 'rootFilter',
    quantifiers: ['any', 'none'],
    condition: 'relations[alias].filter',
  },
  scalarExpressions: {
    language: 'teable-formula',
    functions: Object.freeze(Object.values(FunctionName)),
    referenceTypes: ['field', 'system', 'parameter'],
    limits: dataQueryExpressionLimits,
  },
  aggregateExpressions: {
    version: 4,
    input: 'expr',
    metricFilter: true,
    having: {
      language: 'teable-formula',
      referenceTypes: ['output', 'parameter'],
      scalarBoolean: true,
      blankIsFalse: true,
    },
  },
} as const;
