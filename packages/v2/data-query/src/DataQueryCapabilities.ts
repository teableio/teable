import { FunctionName } from '@teable/v2-core';

import { dataQueryExpressionLimits } from './DataQueryExpression';

/** The canonical execution contract, shared by native schema/describe consumers. */
export const dataQueryCapabilities = {
  definitionVersions: [1, 2, 3],
  scalarExpressions: {
    language: 'teable-formula',
    functions: Object.freeze(Object.values(FunctionName)),
    referenceTypes: ['field', 'system', 'parameter'],
    limits: dataQueryExpressionLimits,
  },
} as const;
