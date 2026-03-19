import { ok } from 'neverthrow';
import { expect } from 'vitest';

import { FieldOperationPluginRunner } from '../application/services/FieldOperationPluginRunner';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type {
  FieldOperationKind,
  FieldOperationPluginContext,
  IFieldOperationPlugin,
} from '../ports/FieldOperationPlugin';
import { DefaultTableMapper } from '../ports/mappers/defaults/DefaultTableMapper';

const tableMapper = new DefaultTableMapper();

export const createFieldOperationPluginRunner = (
  plugins: IFieldOperationPlugin[] = []
): FieldOperationPluginRunner => {
  return new FieldOperationPluginRunner(plugins, new NoopLogger(), tableMapper);
};

export interface ITrackedFieldOperationPluginCalls {
  readonly supports: FieldOperationKind[];
  readonly prepare: FieldOperationPluginContext[];
  readonly guard: FieldOperationPluginContext[];
  readonly beforePersist: FieldOperationPluginContext[];
  readonly afterCommit: FieldOperationPluginContext[];
}

export const createTrackedFieldOperationPlugin = (
  supportedOperations: ReadonlyArray<FieldOperationKind>
): {
  readonly plugin: IFieldOperationPlugin;
  readonly calls: ITrackedFieldOperationPluginCalls;
} => {
  const calls: {
    supports: FieldOperationKind[];
    prepare: FieldOperationPluginContext[];
    guard: FieldOperationPluginContext[];
    beforePersist: FieldOperationPluginContext[];
    afterCommit: FieldOperationPluginContext[];
  } = {
    supports: [],
    prepare: [],
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
      async prepare(context) {
        calls.prepare.push(context);
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

export const expectFieldOperationPluginToBeSkipped = (
  calls: ITrackedFieldOperationPluginCalls,
  actualOperation: FieldOperationKind
): void => {
  expect(calls.supports).toEqual([actualOperation]);
  expect(calls.prepare).toHaveLength(0);
  expect(calls.guard).toHaveLength(0);
  expect(calls.beforePersist).toHaveLength(0);
  expect(calls.afterCommit).toHaveLength(0);
};
