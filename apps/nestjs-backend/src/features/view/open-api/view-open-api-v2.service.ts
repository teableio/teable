import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { IUpdateRecordOrdersRo } from '@teable/openapi';
import { executeReorderRecordsEndpoint } from '@teable/v2-contract-http-implementation/handlers';
import type { ICommandBus } from '@teable/v2-core';
import { v2CoreTokens } from '@teable/v2-core';

import { CustomHttpException, getDefaultCodeByStatus } from '../../../custom.exception';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';

const internalServerError = 'Internal server error';

@Injectable()
export class ViewOpenApiV2Service {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory
  ) {}

  private throwV2Error(
    error: {
      code: string;
      message: string;
      tags?: ReadonlyArray<string>;
      details?: Readonly<Record<string, unknown>>;
    },
    status: number
  ): never {
    throw new CustomHttpException(error.message, getDefaultCodeByStatus(status), {
      domainCode: error.code,
      domainTags: error.tags,
      details: error.details,
    });
  }

  async updateRecordOrders(
    tableId: string,
    viewId: string,
    updateRecordOrdersRo: IUpdateRecordOrdersRo
  ): Promise<void> {
    const container = await this.v2ContainerService.getContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext();

    const v2Input = {
      tableId,
      recordIds: updateRecordOrdersRo.recordIds,
      order: {
        viewId,
        anchorId: updateRecordOrdersRo.anchorId,
        position: updateRecordOrdersRo.position,
      },
    };

    const result = await executeReorderRecordsEndpoint(context, v2Input, commandBus);
    if (result.status === 200 && result.body.ok) {
      return;
    }

    if (!result.body.ok) {
      this.throwV2Error(result.body.error, result.status);
    }

    throw new HttpException(internalServerError, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
