import type { IObjectArraySchema } from '../action-core';

export interface IDecisionSchema extends Record<string, unknown> {
  groups: IObjectArraySchema;
}

export interface IDecision {
  hasCondition: boolean;
  entryNodeId?: string | null;
  condition: {
    logical: 'and' | 'or';
    conditions: IDecisionCondition[];
  };
}

type IConditionOperator =
  | 'contains'
  | 'doesNotContain'
  | 'equal'
  | 'notEqual'
  | 'isGreater'
  | 'isGreaterEqual'
  | 'isLess'
  | 'isLessEqual'
  | 'in'
  | 'notIn'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'isAnyOf'
  | 'isNoneOf';

export interface IDecisionCondition {
  left: string;
  right: unknown;
  operator: IConditionOperator;
  dataType: string;
  valueType: string;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const DEFAULT_DECISION_SCHEMA: IDecisionSchema = {
  groups: {
    type: 'array',
    elements: [
      {
        type: 'object',
        properties: [
          {
            key: {
              type: 'const',
              value: 'hasCondition',
            },
            value: {
              type: 'const',
              value: true,
            },
          },
          {
            key: {
              type: 'const',
              value: 'entryNodeId',
            },
            value: {
              type: 'null',
            },
          },
          {
            key: {
              type: 'const',
              value: 'condition',
            },
            value: {
              type: 'object',
              properties: [
                {
                  key: {
                    type: 'const',
                    value: 'logical',
                  },
                  value: {
                    type: 'const',
                    value: 'and',
                  },
                },
                {
                  key: {
                    type: 'const',
                    value: 'conditions',
                  },
                  value: {
                    type: 'array',
                    elements: [
                      {
                        type: 'object',
                        properties: [
                          {
                            key: {
                              type: 'const',
                              value: 'dataType',
                            },
                            value: {
                              type: 'const',
                              value: 'text',
                            },
                          },
                          {
                            key: {
                              type: 'const',
                              value: 'valueType',
                            },
                            value: {
                              type: 'const',
                              value: 'text',
                            },
                          },
                          {
                            key: {
                              type: 'const',
                              value: 'left',
                            },
                            value: {
                              type: 'null',
                            },
                          },
                          {
                            key: {
                              type: 'const',
                              value: 'operator',
                            },
                            value: {
                              type: 'const',
                              value: 'contains',
                            },
                          },
                          {
                            key: {
                              type: 'const',
                              value: 'right',
                            },
                            value: {
                              type: 'null',
                            },
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  },
};
