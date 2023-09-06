import knex from 'knex';
import { axios } from '../config/axios';

export class Base {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  static knex = knex({ client: 'sqlite3' });

  static async sqlQuery(tableId: string, viewId: string, sql: string) {
    const response = await axios.post<unknown[]>(`/base/sqlQuery`, {
      sql,
      tableId,
      viewId,
    });
    return response.data;
  }
}
