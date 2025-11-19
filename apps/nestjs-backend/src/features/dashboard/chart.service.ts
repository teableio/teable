import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { ChartType, DataSource, THEMES_KEYS } from '@teable/openapi';

@Injectable()
export class ChartService {
  constructor(private readonly prismaService: PrismaService) {}

  async getDefaultPluginOptions(baseId: string, pluginId: string, tableId?: string) {
    if (pluginId !== 'plgchartV2') {
      return;
    }

    const tables = await this.prismaService.txClient().tableMeta.findMany({
      where: {
        baseId,
        deletedTime: null,
      },
      select: {
        id: true,
      },
      orderBy: {
        order: 'asc',
      },
    });

    if (tables.length === 0) {
      return;
    }

    const defaultTableId = tableId || tables[0].id;

    const fields = await this.prismaService.txClient().field.findMany({
      where: {
        tableId: defaultTableId,
        deletedTime: null,
      },
      select: {
        id: true,
      },
    });

    const viewIds = await this.prismaService.txClient().view.findMany({
      where: {
        tableId: defaultTableId,
        deletedTime: null,
      },
      select: {
        id: true,
      },
    });

    const defaultViewId = viewIds[0].id;

    const defaultFieldId = fields[0].id;

    return {
      chartType: ChartType.Bar,
      dataSource: DataSource.Table,
      query: {
        tableId: defaultTableId,
        viewId: defaultViewId,
        orderBy: { on: 'xAxis', order: 'asc' },
        xAxis: defaultFieldId,
        filter: null,
        groupBy: null,
        seriesArray: 'COUNTA',
      },
      appearance: {
        theme: THEMES_KEYS.BLUE,
        legendVisible: true,
        labelVisible: true,
      },
    };
  }
}
