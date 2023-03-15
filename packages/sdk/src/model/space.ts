import type { ITableSnapshot, ITableVo } from '@teable-group/core';
import { IdPrefix, OpBuilder, generateTableId } from '@teable-group/core';
import type { Connection, Doc } from '@teable/sharedb/lib/client';

export class Space {
  constructor(private connection: Connection) {}

  async createTable(name: string, description?: string) {
    const tableData: ITableVo = {
      id: generateTableId(),
      name,
      description,
    };

    const createSnapshot = OpBuilder.creator.addTable.build(tableData);
    const doc = this.connection.get(`${IdPrefix.Table}_node`, tableData.id);
    return new Promise<Doc<ITableSnapshot>>((resolve, reject) => {
      doc.create(createSnapshot, (error) => {
        if (error) return reject(error);
        console.log(`create table succeed!`, tableData);
        resolve(doc);
      });
    });
  }
}
