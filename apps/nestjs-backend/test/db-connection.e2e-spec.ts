import type { INestApplication } from '@nestjs/common';
import { DriverClient } from '@teable/core';
import type { IDbConnectionVo } from '@teable/openapi';
import {
  createDbConnection as apiCreateDbConnection,
  deleteDbConnection as apiDeleteDbConnection,
  getDbConnection as apiGetDbConnection,
} from '@teable/openapi';
import { initApp } from './utils/init-app';

describe.skip('OpenAPI Db Connection (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it.skipIf(globalThis.testConfig.driver !== DriverClient.Pg)(
    'should manage a db connection',
    async () => {
      console.log('PUBLIC_DATABASE_PROXY', process.env.PUBLIC_DATABASE_PROXY);

      const postResult = (await apiCreateDbConnection(baseId)).data as IDbConnectionVo;
      expect(postResult.url).toEqual(expect.stringContaining('postgresql://'));
      expect(postResult.dsn.driver).toEqual('postgresql');

      const getResult = (await apiGetDbConnection(baseId)).data as IDbConnectionVo;
      expect(getResult.url).toEqual(postResult.url);
      expect(getResult.dsn).toEqual(postResult.dsn);

      expect((await apiDeleteDbConnection(baseId)).status).toEqual(200);
      const result = (await apiGetDbConnection(baseId)).data;
      expect(result).to.be.oneOf([undefined, '', {}]);
    }
  );
});
