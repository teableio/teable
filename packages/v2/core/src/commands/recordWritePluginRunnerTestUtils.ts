import { ok } from 'neverthrow';
import { expect } from 'vitest';
import { RecordWritePluginRunner } from '../application/services/RecordWritePluginRunner';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import { DefaultTableMapper } from '../ports/mappers/defaults/DefaultTableMapper';
import type {
  IRecordWritePlugin,
  RecordWriteOperationKind,
  RecordWritePluginContext,
} from '../ports/RecordWritePlugin';

const tableMapper = new DefaultTableMapper();

export const createRecordWritePluginRunner = (
  plugins: IRecordWritePlugin[] = []
): RecordWritePluginRunner => {
  return new RecordWritePluginRunner(plugins, new NoopLogger(), tableMapper);
};

export interface ITrackedRecordWritePluginCalls {
  readonly supports: RecordWriteOperationKind[];
  readonly prepare: RecordWritePluginContext[];
  readonly prepareStates: unknown[];
  readonly guard: RecordWritePluginContext[];
  readonly beforePersist: RecordWritePluginContext[];
  readonly afterCommit: RecordWritePluginContext[];
}

export const createTrackedRecordWritePlugin = (
  supportedOperations: ReadonlyArray<RecordWriteOperationKind>
): {
  readonly plugin: IRecordWritePlugin;
  readonly calls: ITrackedRecordWritePluginCalls;
} => {
  const calls: {
    supports: RecordWriteOperationKind[];
    prepare: RecordWritePluginContext[];
    prepareStates: unknown[];
    guard: RecordWritePluginContext[];
    beforePersist: RecordWritePluginContext[];
    afterCommit: RecordWritePluginContext[];
  } = {
    supports: [],
    prepare: [],
    prepareStates: [],
    guard: [],
    beforePersist: [],
    afterCommit: [],
  };

  return {
    plugin: {
      name: `tracked-${supportedOperations.join('-') || 'none'}`,
      supports(operation) {
        calls.supports.push(operation);
        return supportedOperations.includes(operation);
      },
      async prepare(context, previousPreparedState) {
        calls.prepare.push(context);
        calls.prepareStates.push(previousPreparedState);
        return ok(undefined);
      },
      async guard(context) {
        calls.guard.push(context);
        return ok(undefined);
      },
      async beforePersist(context) {
        calls.beforePersist.push(context);
        return ok(undefined);
      },
      async afterCommit(context) {
        calls.afterCommit.push(context);
        return ok(undefined);
      },
    },
    calls,
  };
};

export const expectRecordWritePluginToBeSkipped = (
  calls: ITrackedRecordWritePluginCalls,
  actualOperation: RecordWriteOperationKind
): void => {
  expect(calls.supports).toEqual([actualOperation]);
  expect(calls.prepare).toHaveLength(0);
  expect(calls.prepareStates).toHaveLength(0);
  expect(calls.guard).toHaveLength(0);
  expect(calls.beforePersist).toHaveLength(0);
  expect(calls.afterCommit).toHaveLength(0);
};
