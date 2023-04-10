import type { ICreateTableRo, IJsonApiSuccessResponse, ITableVo } from '@teable-group/core';
import type { Connection } from '@teable/sharedb/lib/client';
import axios from 'axios';

export class Space {
  constructor(private connection: Connection) {}

  async createTable(name: string, description?: string) {
    const tableData: ICreateTableRo = {
      name,
      description,
    };

    const response = await axios.post<IJsonApiSuccessResponse<ITableVo>>('/api/table', tableData);
    return response.data.data;
  }
}
