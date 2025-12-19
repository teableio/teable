import { Controller } from '@nestjs/common';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { v2Contract } from '@teable/v2-contract-http';
import { executeCreateTableEndpoint } from '@teable/v2-contract-http-implementation';
import { ActorId, CreateTableHandler } from '@teable/v2-core';
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
        const handler = container.resolve(CreateTableHandler);
        const actorIdResult = ActorId.create(this.cls.get('user.id'));
        if (actorIdResult.isErr()) {
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: actorIdResult.error });
        }
        const result = await executeCreateTableEndpoint(
          { actorId: actorIdResult.value },
          input,
          handler
        );

        if (result.status === 201) return result.body;

        if (result.status === 400) {
          throw new ORPCError('BAD_REQUEST', { message: result.body.error });
        }

        throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.body.error });
      }),
    };
  }
}
