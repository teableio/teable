import { generatePrefixedId, type SpanAttributes } from '@teable/v2-core';

export type ComputedUpdateRunPhase = 'full' | 'sync' | 'async';

export type ComputedUpdateRunContext = {
  runId: string;
  originRunIds: ReadonlyArray<string>;
  phase: ComputedUpdateRunPhase;
  totalSteps: number;
  completedStepsBefore: number;
  taskId?: string;
};

const RUN_ID_PREFIX = 'cur';
const RUN_ID_BODY_LENGTH = 16;

export const createComputedUpdateRun = (params: {
  totalSteps: number;
  completedStepsBefore?: number;
  phase?: ComputedUpdateRunPhase;
  runId?: string;
  originRunIds?: ReadonlyArray<string>;
  taskId?: string;
}): ComputedUpdateRunContext => {
  const runId = params.runId ?? generatePrefixedId(RUN_ID_PREFIX, RUN_ID_BODY_LENGTH);
  const originRunIds = params.originRunIds?.length ? [...params.originRunIds] : [runId];

  return {
    runId,
    originRunIds,
    phase: params.phase ?? 'full',
    totalSteps: params.totalSteps,
    completedStepsBefore: params.completedStepsBefore ?? 0,
    taskId: params.taskId,
  };
};

export const toRunLogContext = (run: ComputedUpdateRunContext): Record<string, unknown> => ({
  computedRunId: run.runId,
  computedOriginRunIds: run.originRunIds,
  computedRunPhase: run.phase,
  computedRunTotalSteps: run.totalSteps,
  computedRunCompletedBefore: run.completedStepsBefore,
  computedTaskId: run.taskId,
});

export const toRunSpanAttributes = (run: ComputedUpdateRunContext): SpanAttributes => {
  const attributes: Record<string, string | number | boolean> = {
    'computed.runId': run.runId,
    'computed.phase': run.phase,
    'computed.totalSteps': run.totalSteps,
    'computed.completedStepsBefore': run.completedStepsBefore,
  };

  if (run.originRunIds.length > 0) {
    attributes['computed.originRunIds'] = run.originRunIds.join(',');
  }

  if (run.taskId) {
    attributes['computed.taskId'] = run.taskId;
  }

  return attributes;
};
