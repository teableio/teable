import { FunctionName } from '@teable/v2-core';

import { dataQueryExpressionLimits } from './DataQueryExpression';

/** The canonical execution contract, shared by native schema/describe consumers. */
export const dataQueryCapabilities = {
  definitionVersions: [1, 2, 3, 4, 5, 6],
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
