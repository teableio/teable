import type { ICreateTableRo, IJsonApiSuccessResponse, ITableVo } from '@teable-group/core';
import type { Connection } from '@teable/sharedb/lib/client';
import axios from 'axios';

export class Space {
  constructor(private connection: Connection) {}

  async createTable({
    name,
    description,
    icon,
  }: {
    name: string;
    description?: string;
    icon?: string;
  }) {
    const tableData: ICreateTableRo = {
      name,
      description,
      icon,
    };

    const response = await axios.post<IJsonApiSuccessResponse<ITableVo>>('/api/table', tableData);
    return response.data.data;
  }
}
