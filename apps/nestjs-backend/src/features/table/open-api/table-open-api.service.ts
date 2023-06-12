import { Injectable } from '@nestjs/common';
import type { ICreateTableRo, ITableSnapshot } from '@teable-group/core';
import { generateTransactionKey, IdPrefix, generateTableId, OpBuilder } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import type { Doc } from '@teable/sharedb';
import { TransactionService } from 'src/share-db/transaction.service';
import { PrismaService } from '../../../prisma.service';
import { ShareDbService } from '../../../share-db/share-db.service';
import type { CreateFieldRo } from '../../field/model/create-field.ro';
import { createFieldInstanceByRo } from '../../field/model/factory';
import type { FieldVo } from '../../field/model/field.vo';
import { FieldOpenApiService } from '../../field/open-api/field-open-api.service';
import type { CreateRecordsRo } from '../../record/create-records.ro';
import { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import type { CreateViewRo } from '../../view/model/create-view.ro';
import { createViewInstanceByRo } from '../../view/model/factory';
import type { ViewVo } from '../../view/model/view.vo';
import { ViewOpenApiService } from '../../view/open-api/view-open-api.service';
import type { CreateTableRo } from '../create-table.ro';
import type { TableVo } from '../table.vo';

@Injectable()
export class TableOpenApiService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly shareDbService: ShareDbService,
    private readonly transactionService: TransactionService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly fieldOpenApiService: FieldOpenApiService
  ) {}

  private async createView(transactionKey: string, tableId: string, viewRos: CreateViewRo[]) {
    const viewCreators: ReturnType<typeof this.viewOpenApiService.createCreators>['creators'] = [];
    const viewVos: ViewVo[] = [];

    viewRos.forEach((viewRo, index) => {
      const { creators, opMeta } = this.viewOpenApiService.createCreators(
        tableId,
        createViewInstanceByRo(viewRo),
        index
      );
      viewVos.push(opMeta);
      viewCreators.push(...creators);
    });
    for (const creator of viewCreators) {
      await creator({ transactionKey, isBackend: true });
    }
    return viewVos;
  }

  private async createField(transactionKey: string, tableId: string, fieldRos: CreateFieldRo[]) {
    const fieldCreators: ReturnType<typeof this.fieldOpenApiService.createCreators>['creators'] =
      [];

    const fieldVos: FieldVo[] = [];
    // process fields
    for (const fieldRo of fieldRos) {
      const fieldInstance = createFieldInstanceByRo(fieldRo);
      const { creators, opMeta } = this.fieldOpenApiService.createCreators(tableId, fieldInstance);
      fieldVos.push(opMeta);
      fieldCreators.push(...creators);
    }
    for (const creator of fieldCreators) {
      await creator({ transactionKey, isBackend: true });
    }
    return fieldVos;
  }

  private async createRecord(transactionKey: string, tableId: string, data: CreateRecordsRo) {
    return this.recordOpenApiService.multipleCreateRecords(tableId, data, transactionKey);
  }

  async createTable(tableRo: CreateTableRo): Promise<TableVo> {
    return await this.prismaService.$transaction(async (prisma) => {
      if (!tableRo.fields || !tableRo.views || !tableRo.data) {
        throw new Error('table fields views and rows are required.');
      }
      const transactionKey = generateTransactionKey();
      this.transactionService.newBackendTransaction(transactionKey, prisma);
      try {
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
      } finally {
        this.transactionService.completeBackendTransaction(transactionKey);
      }
    });
  }

  async createTableMeta(
    prisma: Prisma.TransactionClient,
    transactionKey: string,
    tableRo: CreateTableRo
  ) {
    const snapshot = await this.createTable2Op(prisma, tableRo);
    const tableId = snapshot.table.id;
    const collection = `${IdPrefix.Table}_node`;
    const doc = this.shareDbService.connect().get(collection, tableId);
    const tableSnapshot = await new Promise<ITableSnapshot>((resolve, reject) => {
      doc.create(snapshot, undefined, { transactionKey, isBackend: true }, (error) => {
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
    const doc = this.shareDbService.connect().get(collection, tableId);
    await new Promise<Doc>((resolve, reject) => {
      doc.fetch(() => {
        doc.del(
          {
            transactionKey: generateTransactionKey(),
            opCount: 1,
          },
          (error) => {
            if (error) return reject(error);
            console.log(`delete document ${collection}.${tableId} succeed!`);
            resolve(doc);
          }
        );
      });
    });
  }
}
