import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { IViewRo, IViewVo } from '@teable/core';
import { generateShareId, ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IUpdateRecordOrdersRo } from '@teable/openapi';
import { executeReorderRecordsEndpoint } from '@teable/v2-contract-http-implementation/handlers';
import type { ICommandBus } from '@teable/v2-core';
import { v2CoreTokens } from '@teable/v2-core';
import { pick } from 'lodash';

import { CustomHttpException, getDefaultCodeByStatus } from '../../../custom.exception';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';
import { ViewService } from '../view.service';
import { ViewOpenApiService } from './view-open-api.service';

const internalServerError = 'Internal server error';

@Injectable()
export class ViewOpenApiV2Service {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    private readonly prismaService: PrismaService,
    private readonly viewService: ViewService,
    private readonly viewOpenApiService: ViewOpenApiService
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
    const container = await this.v2ContainerService.getContainerForTable(tableId);
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = await this.v2ContextFactory.createContext(container);

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

  async duplicateView(tableId: string, viewId: string): Promise<IViewVo> {
    const view = await this.viewService.getViewById(tableId, viewId);

    if (view.type === ViewType.Plugin) {
      return this.viewOpenApiService.duplicateView(tableId, viewId);
    }

    const { options: optionsRaw } = await this.prismaService.txClient().view.findFirstOrThrow({
      where: { id: viewId, tableId, deletedTime: null },
      select: { options: true },
    });
    const options = optionsRaw ? JSON.parse(optionsRaw) : undefined;

    return this.prismaService.$tx(async () => {
      return this.viewService.createView(tableId, {
        ...pick(view, [
          'name',
          'type',
          'description',
          'filter',
          'group',
          'columnMeta',
          'sort',
          'enableShare',
          'shareMeta',
          'shareId',
          'isLocked',
        ]),
        options,
        shareId: view.shareId ? generateShareId() : undefined,
      } as IViewRo);
    });
  }
}
