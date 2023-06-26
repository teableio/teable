import { Injectable, Logger } from '@nestjs/common';
import type { ICreateTableRo, ITableSnapshot } from '@teable-group/core';
import { generateTableId, IdPrefix, OpBuilder } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import type { FieldVo } from 'src/features/field/model/field.vo';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import type { CreateFieldRo } from '../../field/model/create-field.ro';
import { createFieldInstanceByRo } from '../../field/model/factory';
import { FieldOpenApiService } from '../../field/open-api/field-open-api.service';
import type { CreateRecordsRo } from '../../record/create-records.ro';
import { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import type { CreateViewRo } from '../../view/model/create-view.ro';
import { createViewInstanceByRo } from '../../view/model/factory';
import { ViewOpenApiService } from '../../view/open-api/view-open-api.service';
import type { CreateTableRo } from '../create-table.ro';
import type { TableVo } from '../table.vo';

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

  private async createView(transactionKey: string, tableId: string, viewRos: CreateViewRo[]) {
    const viewCreationPromises = viewRos.map(async (fieldRo) => {
      const viewInstance = createViewInstanceByRo(fieldRo);
      return this.viewOpenApiService.createView(tableId, viewInstance, transactionKey);
    });
    return await Promise.all(viewCreationPromises);
  }

  private async createField(transactionKey: string, tableId: string, fieldRos: CreateFieldRo[]) {
    const fieldVos: FieldVo[] = [];
    for (const fieldRo of fieldRos) {
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

  private async createRecord(transactionKey: string, tableId: string, data: CreateRecordsRo) {
    return this.recordOpenApiService.multipleCreateRecords(tableId, data, transactionKey);
  }

  async createTable(tableRo: CreateTableRo): Promise<TableVo> {
    return await this.transactionService.$transaction(
      this.shareDbService,
      async (prisma, transactionKey) => {
        if (!tableRo.fields || !tableRo.views || !tableRo.data) {
          throw new Error('table fields views and rows are required.');
        }
        const tableVo = await this.createTableMeta(prisma, transactionKey, tableRo);

        const tableId = tableVo.id;

        const viewVos = await this.createView(transactionKey, tableId, tableRo.views);
        const fieldVos = await this.createField(transactionKey, tableId, tableRo.fields);
        const data = await this.createRecord(transactionKey, tableId, tableRo.data);
        return {
          ...tableVo,
          fields: fieldVos,
          views: viewVos,
          data,
        };
      }
    );
  }

  async createTableMeta(
    prisma: Prisma.TransactionClient,
    transactionKey: string,
    tableRo: CreateTableRo
  ) {
    const snapshot = await this.createTable2Op(prisma, tableRo);
    const tableId = snapshot.table.id;
    const collection = `${IdPrefix.Table}_node`;
    const connection = this.shareDbService.getConnection(transactionKey);
    const doc = connection.get(collection, tableId);
    const tableSnapshot = await new Promise<ITableSnapshot>((resolve, reject) => {
      doc.create(snapshot, (error) => {
        if (error) return reject(error);
        resolve(doc.data);
      });
    });
    return tableSnapshot.table;
  }

  private async createTable2Op(prisma: Prisma.TransactionClient, tableRo: ICreateTableRo) {
    const tableAggregate = await prisma.tableMeta.aggregate({
      where: { deletedTime: null },
      _max: { order: true },
    });
    const tableId = generateTableId();
    const maxTableOrder = tableAggregate._max.order || 0;

    return OpBuilder.creator.addTable.build({
      ...tableRo,
      id: tableId,
      order: maxTableOrder + 1,
    });
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
