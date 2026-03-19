import type { Result } from 'neverthrow';

import type { IFieldUpdateInput } from '../commands/UpdateFieldCommand';
import type { IDomainContext } from '../domain/shared/DomainContext';
import type { DomainError } from '../domain/shared/DomainError';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import type { Field } from '../domain/table/fields/Field';
import type { FieldId } from '../domain/table/fields/FieldId';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../domain/table/Table';
import type { ResolvedTableFieldInput } from '../schemas/field';
import type { IExecutionContext } from './ExecutionContext';
import type { PluginTraceContext } from './Tracer';

export const FieldOperationKind = {
  create: 'create',
  update: 'update',
  delete: 'delete',
  duplicate: 'duplicate',
} as const;

export type FieldOperationKind = (typeof FieldOperationKind)[keyof typeof FieldOperationKind];

export const FieldOperationTargetKind = {
  direct: 'direct',
  sideEffect: 'sideEffect',
} as const;

export type FieldOperationTargetKind =
  (typeof FieldOperationTargetKind)[keyof typeof FieldOperationTargetKind];

export type FieldOperationPluginTarget = {
  readonly kind: FieldOperationTargetKind;
  readonly sourceTable: Table;
  readonly sourceOperation: FieldOperationKind;
};

export type FieldOperationPluginEnforce = 'pre' | 'post';

type FieldOperationPluginHookResult<T> = Result<T, DomainError> | Promise<Result<T, DomainError>>;

interface IFieldOperationPluginContextBase<TKind extends FieldOperationKind, TPayload, TResult> {
  readonly kind: TKind;
  readonly executionContext: IExecutionContext;
  readonly table: Table;
  readonly target: FieldOperationPluginTarget;
  readonly payload: TPayload;
  readonly result?: TResult;
  readonly trace?: PluginTraceContext;
  readonly isTransactionBound: boolean;
}

export type FieldOperationCreatePayload = {
  readonly field?: ResolvedTableFieldInput;
  readonly candidateField?: Field;
  readonly order?: {
    readonly viewId: string;
    readonly orderIndex: number;
  };
  readonly foreignTables: ReadonlyArray<Table>;
  readonly domainContext?: IDomainContext;
};

export type FieldOperationCreateResult = {
  readonly createdField: Field;
};

export type FieldOperationUpdatePayload = {
  readonly fieldId: FieldId;
  readonly fieldUpdate: IFieldUpdateInput;
  readonly previousField: Field;
  readonly updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>;
  readonly foreignTables: ReadonlyArray<Table>;
  readonly allowNoop: boolean;
};

export type FieldOperationUpdateResult = {
  readonly updatedField: Field;
};

export type FieldOperationDeletePayload = {
  readonly fieldId: FieldId;
  readonly targetField: Field;
  readonly foreignTables: ReadonlyArray<Table>;
  readonly skipUndoRedo: boolean;
};

export type FieldOperationDeleteResult = {
  readonly deletedField: Field;
};

export type FieldOperationDuplicatePayload = {
  readonly fieldId: FieldId;
  readonly sourceField: Field;
  readonly foreignTables: ReadonlyArray<Table>;
  readonly includeRecordValues: boolean;
  readonly newFieldName?: string;
  readonly viewId?: string;
};

export type FieldOperationDuplicateResult = {
  readonly sourceField: Field;
  readonly duplicatedField: Field;
};

export type IFieldOperationCreateContext = IFieldOperationPluginContextBase<
  'create',
  FieldOperationCreatePayload,
  FieldOperationCreateResult
>;

export type IFieldOperationUpdateContext = IFieldOperationPluginContextBase<
  'update',
  FieldOperationUpdatePayload,
  FieldOperationUpdateResult
>;

export type IFieldOperationDeleteContext = IFieldOperationPluginContextBase<
  'delete',
  FieldOperationDeletePayload,
  FieldOperationDeleteResult
>;

export type IFieldOperationDuplicateContext = IFieldOperationPluginContextBase<
  'duplicate',
  FieldOperationDuplicatePayload,
  FieldOperationDuplicateResult
>;

export type FieldOperationPluginContextMap = {
  create: IFieldOperationCreateContext;
  update: IFieldOperationUpdateContext;
  delete: IFieldOperationDeleteContext;
  duplicate: IFieldOperationDuplicateContext;
};

export type FieldOperationPluginContext = FieldOperationPluginContextMap[FieldOperationKind];

export interface IFieldOperationPlugin<TPreparedState = unknown> {
  readonly name: string;
  /**
   * Ordering hint applied when resolving matching plugins.
   * Hooks observe `pre -> default -> post` order.
   * `beforePersist` still runs serially in that resolved order because it executes inside
   * the transaction and must not fan out parallel work.
   */
  readonly enforce?: FieldOperationPluginEnforce;

  supports(operation: FieldOperationKind): boolean;

  prepare?(context: FieldOperationPluginContext): FieldOperationPluginHookResult<TPreparedState>;

  guard?(
    context: FieldOperationPluginContext,
    preparedState: TPreparedState | undefined
  ): FieldOperationPluginHookResult<void>;

  beforePersist?(
    context: FieldOperationPluginContext,
    preparedState: TPreparedState | undefined
  ): FieldOperationPluginHookResult<void>;

  afterCommit?(
    context: FieldOperationPluginContext,
    preparedState: TPreparedState | undefined
  ): FieldOperationPluginHookResult<void>;
}
