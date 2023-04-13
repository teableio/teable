import type { ICreateTableRo } from '@teable-group/core';
import { generateTableId, generateTransactionKey, IdPrefix, OpBuilder } from '@teable-group/core';
import type { Doc } from '@teable/sharedb';
import { prismaClient } from '@/backend/config/container.config';
import { createFieldInstanceByRo } from 'server/services/field/model/factory';
import { fieldOpenApiService } from 'server/services/field/open-api/field-open-api.service';
import { recordOpenApiService } from 'server/services/record/open-api/record-open-api.service';
import { shareDbService } from 'server/services/share-db/share-db.service';
import { viewOpenApiService } from 'server/services/view/open-api/view-open-api.service';
import { createViewInstanceByRo } from '../../view/model/factory';
import type { CreateTableRo } from '../create-table.ro';

export class TableOpenApiService {
  private getTransactionMeta(tableRo: CreateTableRo) {
    const tableCount = 1;
    const fieldCount = tableRo.fields?.length || 0;
    const viewCount = tableRo.views?.length || 0;
    const records = tableRo.rows?.records;
    // record ops count is adds up to record length and every record that has fields keys
    const recordCount = records
      ? records.length +
        records.reduce((pre, cur) => {
          Object.keys(cur.fields).length && pre++;
          return pre;
        }, 0)
      : 0;

    return {
      transactionKey: generateTransactionKey(),
      opCount: tableCount + fieldCount + viewCount + recordCount,
    };
  }

  async createTable(tableRo: CreateTableRo) {
    if (!tableRo.fields || !tableRo.views || !tableRo.rows) {
      throw new Error('table fields views and rows are required.');
    }
    const transactionMeta = this.getTransactionMeta(tableRo);

    const tableVo = await this.createTableMeta(tableRo, transactionMeta);
    const tableId = tableVo.id;

    for (const viewRo of tableRo.views) {
      await viewOpenApiService.createView(tableId, createViewInstanceByRo(viewRo), transactionMeta);
    }

    for (const fieldRo of tableRo.fields) {
      await fieldOpenApiService.createField(
        tableId,
        createFieldInstanceByRo(fieldRo),
        transactionMeta
      );
    }

    await recordOpenApiService.multipleCreateRecords(tableId, tableRo.rows, transactionMeta);

    return tableVo;
  }

  async createTableMeta(
    tableRo: CreateTableRo,
    transactionMeta: { transactionKey: string; opCount: number }
  ) {
    const snapshot = await this.createTable2Op(tableRo);
    const tableId = snapshot.table.id;
    const collection = `${IdPrefix.Table}_node`;
    const doc = shareDbService.connect().get(collection, tableId);
    await new Promise<Doc>((resolve, reject) => {
      doc.create(snapshot, undefined, transactionMeta, (error) => {
        if (error) return reject(error);
        // console.log(`create document ${collectionId}.${id} succeed!`);
        resolve(doc);
      });
    });

    return snapshot.table;
  }

  private async createTable2Op(tableRo: ICreateTableRo) {
    const tableAggregate = await prismaClient.tableMeta.aggregate({
      _max: { order: true },
    });
    const tableId = generateTableId();
    const maxTableOrder = tableAggregate._max.order || 0;

    return OpBuilder.creator.addTable.build(
      {
        ...tableRo,
        id: tableId,
      },
      maxTableOrder + 1
    );
  }
}

export const tableOpenApiService = new TableOpenApiService();
