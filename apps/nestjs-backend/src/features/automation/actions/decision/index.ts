import type { IObjectArraySchema } from '../action-core';

export interface IDecisionSchema extends Record<string, unknown> {
  groups: IObjectArraySchema;
}

export interface IDecision {
  hasCondition: boolean;
  entryNodeId?: string | null;
  condition: {
    conjunction: 'and' | 'or';
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
