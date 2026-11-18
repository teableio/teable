import { FunctionName } from '@teable/v2-core';

import { dataQueryExpressionLimits } from './DataQueryExpression';

/** The canonical execution contract, shared by native schema/describe consumers. */
export const dataQueryCapabilities = {
  definitionVersions: [1, 2, 3, 4, 5, 6, 8],
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
