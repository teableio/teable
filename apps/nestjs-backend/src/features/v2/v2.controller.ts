/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { Controller } from '@nestjs/common';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { v2Contract } from '@teable/v2-contract-http';
import {
  executeCreateTableEndpoint,
  executeDeleteRecordsEndpoint,
  executeGetTableByIdEndpoint,
} from '@teable/v2-contract-http-implementation/handlers';
import { v2CoreTokens } from '@teable/v2-core';
import type { IQueryBus, ICommandBus } from '@teable/v2-core' with { 'resolution-mode': 'import' };
import { V2ContainerService } from './v2-container.service';
import { V2ExecutionContextFactory } from './v2-execution-context.factory';

@Controller('api/v2')
export class V2Controller {
  constructor(
    private readonly v2Container: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory
  ) {}

  @Implement(v2Contract.tables)
  tables() {
    return {
      create: implement(v2Contract.tables.create).handler(async ({ input }) => {
        const container = await this.v2Container.getContainer();
        const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
        const context = await this.v2ContextFactory.createContext();

        const result = await executeCreateTableEndpoint(context, input, commandBus);

        if (result.status === 201) return result.body;

        if (result.status === 400) {
          throw new ORPCError('BAD_REQUEST', { message: result.body.error });
        }

        throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.body.error });
      }),
      getById: implement(v2Contract.tables.getById).handler(async ({ input }) => {
        const container = await this.v2Container.getContainer();
        const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
        const context = await this.v2ContextFactory.createContext();

        const result = await executeGetTableByIdEndpoint(context, input, queryBus);
        if (result.status === 200) return result.body;

        if (result.status === 400) {
          throw new ORPCError('BAD_REQUEST', { message: result.body.error });
        }

        if (result.status === 404) {
          throw new ORPCError('NOT_FOUND', { message: result.body.error });
        }

        // Placeholder for actual implementation
        throw new ORPCError('NOT_IMPLEMENTED', { message: 'Not implemented yet' });
      }),
      deleteRecords: implement(v2Contract.tables.deleteRecords).handler(async ({ input }) => {
        const container = await this.v2Container.getContainer();
        const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
        const context = await this.v2ContextFactory.createContext();

        const result = await executeDeleteRecordsEndpoint(context, input, commandBus);

        if (result.status === 200) return result.body;

        if (result.status === 400) {
          throw new ORPCError('BAD_REQUEST', { message: result.body.error });
        }

        if (result.status === 404) {
          throw new ORPCError('NOT_FOUND', { message: result.body.error });
        }

        throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.body.error });
      }),
    };
  }
}
