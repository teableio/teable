import { ok } from 'neverthrow';

import { TableOperationPluginRunner } from '../application/services/TableOperationPluginRunner';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { ITableOperationPlugin } from '../ports/TableOperationPlugin';

export const createTableOperationPluginRunner = (
  plugins: ITableOperationPlugin[] = []
): TableOperationPluginRunner => new TableOperationPluginRunner(plugins, new NoopLogger());

export const createNoopTableOperationPlugin = (): ITableOperationPlugin => ({
  name: 'noop-table-operation-plugin',
  supports: () => true,
  guard: () => ok(undefined),
});
