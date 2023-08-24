import type { IJsonApiSuccessResponse } from '@teable-group/core';
import type { Knex } from 'knex';
import knex from 'knex';
import { axios } from '../config/axios';

export class Base {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  static knex = knex({ client: 'sqlite3' });

  static async sqlQuery(data: Knex.SqlNative) {
    const response = await axios.post<IJsonApiSuccessResponse<unknown[]>>(
      `/api/base/sqlQuery`,
      data
    );
    return response.data.data;
  }
}
