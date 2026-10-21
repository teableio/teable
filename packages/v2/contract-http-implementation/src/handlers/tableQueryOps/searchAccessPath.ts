import type {
  IGetSearchAccessPathCapabilitiesEndpointResult,
  IGetSearchAccessPathStatusEndpointResult,
  IGetSearchAccessPathStatusInput,
  IReconcileSearchAccessPathEndpointResult,
  IReconcileSearchAccessPathInput,
} from '@teable/v2-contract-http';
import { mapDomainErrorToHttpError, mapDomainErrorToHttpStatus } from '@teable/v2-contract-http';
import {
  domainError,
  TableByIdSpec,
  TableId,
  type DomainError,
  type IExecutionContext,
  type ITableRepository,
  type Table,
} from '@teable/v2-core';
import type {
  ReconcileTableSearchAccessPathInput,
  TableSearchAccessPathCapabilityReader,
  TableSearchAccessPathReconciler,
  TableSearchVectorStatusReader,
} from '@teable/v2-table-query-ops';

const errorResult = (error: DomainError) => ({
  status: mapDomainErrorToHttpStatus(error),
  body: { ok: false as const, error: mapDomainErrorToHttpError(error) },
});

const findTable = async (
  context: IExecutionContext,
  tableId: string,
  tableRepository: ITableRepository
): Promise<{ table: Table } | { error: DomainError }> => {
  const tableIdResult = TableId.create(tableId);
  if (tableIdResult.isErr()) return { error: tableIdResult.error };

  const tableResult = await tableRepository.findOne(
    context,
    TableByIdSpec.create(tableIdResult.value)
  );
  if (tableResult.isErr()) return { error: tableResult.error };
  if (!tableResult.value) {
    return {
      error: domainError.notFound({
        code: 'table.not_found',
        message: 'Table not found',
        details: { tableId },
      }),
    };
  }
  return { table: tableResult.value };
};

export const executeGetSearchAccessPathStatusEndpoint = async (
  context: IExecutionContext,
  input: IGetSearchAccessPathStatusInput,
  tableRepository: ITableRepository,
  statusReader: TableSearchVectorStatusReader
): Promise<IGetSearchAccessPathStatusEndpointResult> => {
  const tableResult = await findTable(context, input.tableId, tableRepository);
  if ('error' in tableResult) return errorResult(tableResult.error);

  const statusResult = await statusReader.read(context, input.tableId);
  if (statusResult.isErr()) return errorResult(statusResult.error);
  return { status: 200, body: { ok: true, data: { status: statusResult.value } } };
};

export const executeGetSearchAccessPathCapabilitiesEndpoint = async (
  context: IExecutionContext,
  capabilityReader: TableSearchAccessPathCapabilityReader
): Promise<IGetSearchAccessPathCapabilitiesEndpointResult> => {
  const capabilitiesResult = await capabilityReader.read(context);
  if (capabilitiesResult.isErr()) return errorResult(capabilitiesResult.error);
  return {
    status: 200,
    body: { ok: true, data: { capabilities: [...capabilitiesResult.value] } },
  };
};

export const executeReconcileSearchAccessPathEndpoint = async (
  context: IExecutionContext,
  input: IReconcileSearchAccessPathInput,
  tableRepository: ITableRepository,
  reconciler: TableSearchAccessPathReconciler,
  allowSearchAccessPathMutation: boolean
): Promise<IReconcileSearchAccessPathEndpointResult> => {
  if (!allowSearchAccessPathMutation) {
    return errorResult(
      domainError.forbidden({
        code: 'table_query_ops.search_access_path_mutation_disabled',
        message: 'Managed search access-path mutation is disabled by the host',
      })
    );
  }

  const tableResult = await findTable(context, input.tableId, tableRepository);
  if ('error' in tableResult) return errorResult(tableResult.error);

  const reconcileInput: ReconcileTableSearchAccessPathInput = {
    table: tableResult.table,
    mode: input.mode,
    ...(input.expectedDefinitionKey !== undefined
      ? { expectedDefinitionKey: input.expectedDefinitionKey }
      : {}),
    ...(input.semantics !== undefined ? { semantics: input.semantics } : {}),
    ...(input.provider !== undefined ? { provider: input.provider } : {}),
    ...(input.languageConfig !== undefined ? { languageConfig: input.languageConfig } : {}),
    ...(input.fieldIds !== undefined ? { fieldIds: input.fieldIds } : {}),
    ...(input.searchProbe !== undefined ? { searchProbe: input.searchProbe } : {}),
    validationMode: 'real_ddl',
    allowLargeTableRewrite: false,
  };
  const reconcileResult = await reconciler.reconcile(context, reconcileInput);
  if (reconcileResult.isErr()) return errorResult(reconcileResult.error);
  return {
    status: 200,
    body: {
      ok: true,
      data: {
        result: {
          ...reconcileResult.value,
          fieldIds: [...reconcileResult.value.fieldIds],
        },
      },
    },
  };
};
