import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from './ExecutionContext';
import type { PluginTraceContext } from './Tracer';

export const ViewOperationKind = {
  create: 'create',
  duplicate: 'duplicate',
  update: 'update',
} as const;

export type ViewOperationKind = (typeof ViewOperationKind)[keyof typeof ViewOperationKind];

export type ViewOperationPluginEnforce = 'pre' | 'post';

type ViewOperationPluginHookResult<T> = Result<T, DomainError> | Promise<Result<T, DomainError>>;

export type ViewOperationPayloadViewConfig = {
  readonly name?: string | null;
  readonly description?: string | null;
  readonly filter?: unknown;
  readonly sort?: unknown;
  readonly group?: unknown;
  readonly options?: unknown;
};

type ViewOperationCountLimitPayload = {
  readonly tableId: string;
  readonly currentViewCount: number;
  readonly addedViewCount?: number;
};

export type ViewOperationCreatePayload = ViewOperationCountLimitPayload & {
  readonly view: ViewOperationPayloadViewConfig;
};

export type ViewOperationDuplicatePayload = ViewOperationCountLimitPayload & {
  readonly sourceViewId?: string;
  readonly view: ViewOperationPayloadViewConfig;
};

export type ViewOperationUpdatePayload = {
  readonly tableId: string;
  readonly viewId: string;
  readonly patch: ViewOperationPayloadViewConfig;
};

interface IViewOperationPluginContextBase<TKind extends ViewOperationKind, TPayload> {
  readonly kind: TKind;
  readonly executionContext: IExecutionContext;
  readonly payload: TPayload;
  readonly trace?: PluginTraceContext;
  readonly isTransactionBound: boolean;
}

export type IViewOperationCreateContext = IViewOperationPluginContextBase<
  'create',
  ViewOperationCreatePayload
>;

export type IViewOperationDuplicateContext = IViewOperationPluginContextBase<
  'duplicate',
  ViewOperationDuplicatePayload
>;

export type IViewOperationUpdateContext = IViewOperationPluginContextBase<
  'update',
  ViewOperationUpdatePayload
>;

export type ViewOperationPluginContextMap = {
  create: IViewOperationCreateContext;
  duplicate: IViewOperationDuplicateContext;
  update: IViewOperationUpdateContext;
};

export type ViewOperationPluginContext = ViewOperationPluginContextMap[ViewOperationKind];

export interface IViewOperationPlugin<TPreparedState = unknown> {
  readonly name: string;
  readonly enforce?: ViewOperationPluginEnforce;

  supports(operation: ViewOperationKind): boolean;

  prepare?(context: ViewOperationPluginContext): ViewOperationPluginHookResult<TPreparedState>;

  guard?(
    context: ViewOperationPluginContext,
    preparedState: TPreparedState | undefined
  ): ViewOperationPluginHookResult<void>;
}
