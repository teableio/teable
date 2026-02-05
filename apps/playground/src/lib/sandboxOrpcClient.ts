import { ORPCError, createORPCClient } from '@orpc/client';
import type { ClientLink } from '@orpc/client';
import type { ContractRouterClient } from '@orpc/contract';
import {
  executeCreateFieldEndpoint,
  executeCreateRecordEndpoint,
  executeCreateTableEndpoint,
  executeDeleteFieldEndpoint,
  executeDeleteRecordsEndpoint,
  executeDeleteTableEndpoint,
  executeGetTableByIdEndpoint,
  executeImportCsvEndpoint,
  executeListTableRecordsEndpoint,
  executeListTablesEndpoint,
  executeRenameTableEndpoint,
  executeUpdateRecordEndpoint,
} from '@teable/v2-contract-http-implementation/handlers';
import {
  ActorId,
  type ICommandBus,
  type IExecutionContext,
  type IQueryBus,
  v2CoreTokens,
} from '@teable/v2-core';

import { SANDBOX_ACTOR_ID } from '@/lib/playground/constants';
import { createSandboxContainer } from '@/lib/sandboxContainer';

type V2ContractRouter = (typeof import('@teable/v2-contract-http'))['v2Contract'];
type V2OrpcClient = ContractRouterClient<V2ContractRouter>;

type SandboxHandler = (input: unknown, executionContext: IExecutionContext) => Promise<unknown>;

const actorIdResult = ActorId.create(SANDBOX_ACTOR_ID);
if (actorIdResult.isErr()) {
  throw new Error(actorIdResult.error);
}
const sandboxActorId = actorIdResult.value;

const createExecutionContext = (): IExecutionContext => ({
  actorId: sandboxActorId,
});

const getErrorMessage = (body: unknown, fallback: string): string => {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
    return body.error;
  }

  return fallback;
};

const toSandboxError = (status: number, body: unknown): never => {
  if (status === 400) {
    throw new ORPCError('BAD_REQUEST', { message: getErrorMessage(body, 'Bad request') });
  }

  if (status === 404) {
    throw new ORPCError('NOT_FOUND', { message: getErrorMessage(body, 'Not found') });
  }

  throw new ORPCError('INTERNAL_SERVER_ERROR', {
    message: getErrorMessage(body, 'Internal server error'),
  });
};

const unwrapEndpointResult = <T extends { status: number; body: unknown }>(result: T) => {
  if (result.status >= 200 && result.status < 300) {
    return result.body;
  }

  return toSandboxError(result.status, result.body);
};

const createSandboxHandlers = (): Record<string, SandboxHandler> => ({
  'tables.create': async (input, executionContext) => {
    const container = await createSandboxContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeCreateTableEndpoint(executionContext, input, commandBus);
    return unwrapEndpointResult(result);
  },
  'tables.createField': async (input, executionContext) => {
    const container = await createSandboxContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeCreateFieldEndpoint(executionContext, input, commandBus);
    return unwrapEndpointResult(result);
  },
  'tables.createRecord': async (input, executionContext) => {
    const container = await createSandboxContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeCreateRecordEndpoint(executionContext, input, commandBus);
    return unwrapEndpointResult(result);
  },
  'tables.updateRecord': async (input, executionContext) => {
    const container = await createSandboxContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeUpdateRecordEndpoint(executionContext, input, commandBus);
    return unwrapEndpointResult(result);
  },
  'tables.deleteRecords': async (input, executionContext) => {
    const container = await createSandboxContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeDeleteRecordsEndpoint(executionContext, input, commandBus);
    return unwrapEndpointResult(result);
  },
  'tables.deleteField': async (input, executionContext) => {
    const container = await createSandboxContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeDeleteFieldEndpoint(executionContext, input, commandBus);
    return unwrapEndpointResult(result);
  },
  'tables.getById': async (input, executionContext) => {
    const container = await createSandboxContainer();
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const result = await executeGetTableByIdEndpoint(executionContext, input, queryBus);
    return unwrapEndpointResult(result);
  },
  'tables.delete': async (input, executionContext) => {
    const container = await createSandboxContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeDeleteTableEndpoint(executionContext, input, commandBus);
    return unwrapEndpointResult(result);
  },
  'tables.list': async (input, executionContext) => {
    const container = await createSandboxContainer();
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const result = await executeListTablesEndpoint(executionContext, input, queryBus);
    return unwrapEndpointResult(result);
  },
  'tables.listRecords': async (input, executionContext) => {
    const container = await createSandboxContainer();
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const result = await executeListTableRecordsEndpoint(executionContext, input, queryBus);
    return unwrapEndpointResult(result);
  },
  'tables.rename': async (input, executionContext) => {
    const container = await createSandboxContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeRenameTableEndpoint(executionContext, input, commandBus);
    return unwrapEndpointResult(result);
  },
  'tables.importCsv': async (input, executionContext) => {
    const container = await createSandboxContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeImportCsvEndpoint(executionContext, input, commandBus);
    return unwrapEndpointResult(result);
  },
});

const sandboxHandlers = createSandboxHandlers();

let sandboxClient: V2OrpcClient | undefined;

export const getSandboxOrpcClient = (): V2OrpcClient => {
  if (!sandboxClient) {
    const link: ClientLink<Record<string, never>> = {
      call: async (path, input, _options) => {
        const key = path.join('.');
        const handler = sandboxHandlers[key];

        if (!handler) {
          throw new ORPCError('NOT_FOUND', { message: `Unknown sandbox procedure: ${key}` });
        }

        return handler(input, createExecutionContext());
      },
    };

    sandboxClient = createORPCClient(link) as V2OrpcClient;
  }

  return sandboxClient;
};
