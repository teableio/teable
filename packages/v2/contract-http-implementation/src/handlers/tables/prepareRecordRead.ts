import type { IHandlerResolver } from '@teable/v2-contract-http';
import {
  RecordQueryPluginRunner,
  TableId,
  TableQueryService,
  v2CoreTokens,
  type IExecutionContext,
  type RecordQueryPluginContext,
} from '@teable/v2-core';
import { safeTry, ok } from 'neverthrow';

export const prepareRecordRead = (
  context: IExecutionContext,
  tableId: string,
  container: IHandlerResolver,
  operation: Pick<RecordQueryPluginContext, 'kind' | 'payload'>
) => safeTry(async function* () {
  const id = yield* TableId.create(tableId);
  const table = yield* await container.resolve<TableQueryService>(v2CoreTokens.tableQueryService).getById(context, id);
  const runner = container.resolve<RecordQueryPluginRunner>(v2CoreTokens.recordQueryPluginRunner);
  const execution = yield* await runner.prepare({ ...operation, executionContext: context, table } as RecordQueryPluginContext);
  yield* await execution.guard();
  const queryScope = yield* execution.getScope();
  return ok({ table, queryScope });
});
