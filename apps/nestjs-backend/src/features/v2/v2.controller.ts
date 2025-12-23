import { Controller } from '@nestjs/common';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { v2Contract } from '@teable/v2-contract-http';
import {
  executeCreateTableEndpoint,
  executeGetTableByIdEndpoint,
} from '@teable/v2-contract-http-implementation';
import { ActorId, v2CoreTokens } from '@teable/v2-core';
import type {
  IQueryBus,
  ICommandBus,
  ITracer,
} from '@teable/v2-core' with { 'resolution-mode': 'import' };
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { V2ContainerService } from './v2-container.service';

@Controller('api/v2')
export class V2Controller {
  constructor(
    private readonly v2Container: V2ContainerService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @Implement(v2Contract.tables)
  tables() {
    return {
      create: implement(v2Contract.tables.create).handler(async ({ input }) => {
        const container = await this.v2Container.getContainer();
        const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
        const tracer = container.resolve<ITracer>(v2CoreTokens.tracer);
        const actorIdResult = ActorId.create(this.cls.get('user.id'));
        if (actorIdResult.isErr()) {
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: actorIdResult.error });
        }
        const result = await executeCreateTableEndpoint(
          { actorId: actorIdResult.value, tracer },
          input,
          commandBus
        );

        if (result.status === 201) return result.body;

        if (result.status === 400) {
          throw new ORPCError('BAD_REQUEST', { message: result.body.error });
        }

        throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.body.error });
      }),
      getById: implement(v2Contract.tables.getById).handler(async ({ input }) => {
        const container = await this.v2Container.getContainer();
        const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
        const tracer = container.resolve<ITracer>(v2CoreTokens.tracer);
        const actorIdResult = ActorId.create(this.cls.get('user.id'));
        if (actorIdResult.isErr()) {
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: actorIdResult.error });
        }
        const result = await executeGetTableByIdEndpoint(
          { actorId: actorIdResult.value, tracer },
          input,
          queryBus
        );
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
    };
  }
}
