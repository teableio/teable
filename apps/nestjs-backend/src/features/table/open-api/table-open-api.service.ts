import { Injectable } from '@nestjs/common';
import type { ICreateTableRo, IRecordSnapshot, ITableSnapshot } from '@teable-group/core';
import {
  FieldKeyType,
  generateTransactionKey,
  IdPrefix,
  generateTableId,
  OpBuilder,
} from '@teable-group/core';
import type { Doc } from '@teable/sharedb';
import { keyBy } from 'lodash';
import { PrismaService } from '../../../prisma.service';
import { ShareDbService } from '../../../share-db/share-db.service';
import type { ITransactionMeta } from '../../../share-db/transaction.service';
import type { ITransactionCreator } from '../../../utils/transaction-creator';
import type { IFieldInstance } from '../../field/model/factory';
import { createFieldInstanceByRo } from '../../field/model/factory';
import type { FieldVo } from '../../field/model/field.vo';
import { FieldOpenApiService } from '../../field/open-api/field-open-api.service';
import { RecordOpenApiService } from '../../record/open-api/record-open-api.service';
import { createViewInstanceByRo } from '../../view/model/factory';
import type { ViewVo } from '../../view/model/view.vo';
import { ViewOpenApiService } from '../../view/open-api/view-open-api.service';
import type { CreateTableRo } from '../create-table.ro';
import type { TableVo } from '../table.vo';

@Injectable()
export class TableOpenApiService implements ITransactionCreator {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly shareDbService: ShareDbService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly fieldOpenApiService: FieldOpenApiService
  ) {}

  async createTable(tableRo: CreateTableRo): Promise<TableVo> {
    if (!tableRo.fields || !tableRo.views || !tableRo.data) {
      throw new Error('table fields views and rows are required.');
    }

    const { creators: tableCreators, opMeta: tableVo } = await this.createTableMeta(tableRo);
    const tableId = tableVo.id;

    const viewCreators: ReturnType<typeof this.viewOpenApiService.generateCreators>['creators'] =
      [];

    const fieldCreators: ReturnType<typeof this.fieldOpenApiService.generateCreators>['creators'] =
      [];

    const viewVos: ViewVo[] = [];
    const fieldVos: FieldVo[] = [];
    const fieldInstances: IFieldInstance[] = [];

    // process views
    tableRo.views.forEach((viewRo, index) => {
      const { creators, opMeta } = this.viewOpenApiService.generateCreators(
        tableId,
        createViewInstanceByRo(viewRo),
        index
      );
      viewVos.push(opMeta);
      viewCreators.push(...creators);
    });

    // process fields
    for (const fieldRo of tableRo.fields) {
      const fieldInstance = createFieldInstanceByRo(fieldRo);
      const { creators, opMeta } = this.fieldOpenApiService.generateCreators(
        tableId,
        fieldInstance
      );
      fieldVos.push(opMeta);
      fieldCreators.push(...creators);
      fieldInstances.push(fieldInstance);
    }

    // process record
    const fieldName2IdMap = keyBy(
      fieldInstances,
      tableRo.data.fieldKeyType === FieldKeyType.Id ? 'id' : 'name'
    );
    const { creators: recordCreators, afterCreate: afterRecordCreate } =
      this.recordOpenApiService.generateCreators(tableId, fieldName2IdMap, tableRo.data);

    // combine all the creators to generate transaction meta
    const transactionMeta = {
      transactionKey: generateTransactionKey(),
      opCount:
        tableCreators.length + viewCreators.length + fieldCreators.length + recordCreators.length,
    };

    for (const creator of tableCreators) {
      await creator(transactionMeta);
    }
    for (const creator of viewCreators) {
      await creator(transactionMeta);
    }
    for (const creator of fieldCreators) {
      await creator(transactionMeta);
    }

    const recordResult: (IRecordSnapshot | void)[] = [];
    for (const creator of recordCreators) {
      recordResult.push(await creator(transactionMeta));
    }

    // clean record result
    const data = afterRecordCreate(recordResult);

    return {
      ...tableVo,
      fields: fieldVos,
      views: viewVos,
      data,
    };
  }

  generateCreators(snapshot: ITableSnapshot) {
    const tableId = snapshot.table.id;
    const collection = `${IdPrefix.Table}_node`;
    const doc = this.shareDbService.connect().get(collection, tableId);
    const creator = (transactionMeta: ITransactionMeta) => {
      return new Promise<ITableSnapshot>((resolve, reject) => {
        doc.create(snapshot, undefined, transactionMeta, (error) => {
          if (error) return reject(error);
          // console.log(`create document ${collectionId}.${id} succeed!`);
          resolve(doc.data);
        });
      });
    };

    return {
      creators: [creator],
      opMeta: snapshot.table,
    };
  }

  async createTableMeta(tableRo: CreateTableRo) {
    const snapshot = await this.createTable2Op(tableRo);
    return this.generateCreators(snapshot);
  }

  private async createTable2Op(tableRo: ICreateTableRo) {
    const tableAggregate = await this.prismaService.tableMeta.aggregate({
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
