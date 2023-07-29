import { Injectable, Logger } from '@nestjs/common';
import type {
  ICreateRecordsRo,
  ICreateTableRo,
  IFieldRo,
  IFieldVo,
  ITableFullVo,
  ITableOp,
  ITableVo,
  IViewRo,
  IViewVo,
} from '@teable-group/core';
import {
  FieldKeyType,
  getUniqName,
  generateTableId,
  IdPrefix,
  TableOpBuilder,
} from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import { createFieldInstanceByRo } from '../../field/model/factory';
import { FieldOpenApiService } from '../../field/open-api/field-open-api.service';
import { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import { createViewInstanceByRo } from '../../view/model/factory';
import { ViewOpenApiService } from '../../view/open-api/view-open-api.service';

@Injectable()
export class TableOpenApiService {
  private logger = new Logger(TableOpenApiService.name);
  constructor(
    private readonly shareDbService: ShareDbService,
    private readonly transactionService: TransactionService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly fieldOpenApiService: FieldOpenApiService
  ) {}

  private async createView(transactionKey: string, tableId: string, viewRos: IViewRo[]) {
    const viewCreationPromises = viewRos.map(async (fieldRo) => {
      const viewInstance = createViewInstanceByRo(fieldRo);
      return this.viewOpenApiService.createView(tableId, viewInstance, transactionKey);
    });
    return await Promise.all(viewCreationPromises);
  }

  private async createField(
    transactionKey: string,
    tableId: string,
    viewVos: IViewVo[],
    fieldRos: IFieldRo[]
  ) {
    const fieldVos: IFieldVo[] = [];
    for (const fieldRo of fieldRos) {
      viewVos.forEach((view, index) => {
        fieldRo['columnMeta'] = { ...fieldRo.columnMeta, [view.id]: { order: index } };
      });
      const fieldInstance = createFieldInstanceByRo(fieldRo);
      const fieldVo = await this.fieldOpenApiService.createField(
        tableId,
        fieldInstance,
        transactionKey
      );
      fieldVos.push(fieldVo);
    }
    return fieldVos;
  }

  private async createRecord(transactionKey: string, tableId: string, data: ICreateRecordsRo) {
    return this.recordOpenApiService.multipleCreateRecords(tableId, data, transactionKey);
  }

  async createTable(tableRo: ICreateTableRo): Promise<ITableFullVo> {
    return await this.transactionService.$transaction(
      this.shareDbService,
      async (prisma, transactionKey) => {
        if (!tableRo.fields || !tableRo.views || !tableRo.records) {
          throw new Error('table fields views and rows are required.');
        }
        const tableVo = await this.createTableMeta(prisma, transactionKey, tableRo);

        const tableId = tableVo.id;

        const viewVos = await this.createView(transactionKey, tableId, tableRo.views);
        const fieldVos = await this.createField(transactionKey, tableId, viewVos, tableRo.fields);
        const { records } = await this.createRecord(transactionKey, tableId, {
          records: tableRo.records,
          fieldKeyType: tableRo.fieldKeyType ?? FieldKeyType.Name,
        });

        return {
          ...tableVo,
          total: tableRo.records.length,
          fields: fieldVos,
          views: viewVos,
          records,
        };
      }
    );
  }

  async createTableMeta(
    prisma: Prisma.TransactionClient,
    transactionKey: string,
    tableRo: ICreateTableRo
  ) {
    const tableRaws = await prisma.tableMeta.findMany({
      where: { deletedTime: null },
      select: { name: true, order: true },
    });
    const tableId = generateTableId();
    const names = tableRaws.map((table) => table.name);
    const uniqName = getUniqName(tableRo.name ?? 'New table', names);

    const order =
      tableRaws.reduce((acc, cur) => {
        return acc > cur.order ? acc : cur.order;
      }, 0) + 1;

    const snapshot = this.createTable2Op({
      id: tableId,
      name: uniqName,
      description: tableRo.description,
      icon: tableRo.icon,
      order,
      lastModifiedTime: new Date().toISOString(),
    });

    const collection = `${IdPrefix.Table}_node`;
    const connection = this.shareDbService.getConnection(transactionKey);
    const doc = connection.get(collection, tableId);
    return await new Promise<ITableVo>((resolve, reject) => {
      doc.create(snapshot, (error) => {
        if (error) return reject(error);
        resolve(doc.data);
      });
    });
  }

  private createTable2Op(tableVo: ITableOp) {
    return TableOpBuilder.creator.build(tableVo);
  }

  async archiveTable(tableId: string) {
    const collection = `${IdPrefix.Table}_node`;
    return await this.transactionService.$transaction(
      this.shareDbService,
      async (_, transactionKey) => {
        const doc = this.shareDbService.getConnection(transactionKey).get(collection, tableId);
        await new Promise((resolve, reject) => {
          doc.fetch((error) => {
            if (error) return reject(error);
            doc.del({}, (error) => {
              if (error) return reject(error);
              this.logger.log(`delete document ${collection}.${tableId} succeed!`);
              resolve(doc.data);
            });
          });
        });
      }
    );
  }
}
