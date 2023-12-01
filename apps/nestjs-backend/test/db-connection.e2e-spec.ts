/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import { DriverClient } from '@teable-group/core';
import type { IDbConnectionVo } from '@teable-group/openapi';
import type request from 'supertest';
import { initApp } from './utils/init-app';

describe('OpenAPI Db Connection (e2e)', () => {
  let app: INestApplication;
  let request: request.SuperAgentTest;
  const baseId = globalThis.testConfig.baseId;

  if (globalThis.testConfig.driver !== DriverClient.Pg) {
    it('should skip this test', () => {
      expect(true).toBeTruthy();
    });
    return;
  }

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    request = appCtx.request;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should manage a db connection', async () => {
    console.log('PUBLIC_DATABASE_ADDRESS', process.env.PUBLIC_DATABASE_ADDRESS);

    const postResult = (await request.post(`/api/base/${baseId}/connection`).expect(201))
      .body as IDbConnectionVo;
    expect(postResult.url).toEqual(expect.stringContaining('postgresql://'));
    expect(postResult.dsn.driver).toEqual('postgresql');

    const getResult = (await request.get(`/api/base/${baseId}/connection`).expect(200)).body;
    expect(getResult.url).toEqual(postResult.url);
    expect(getResult.dsn).toEqual(postResult.dsn);

    await request.delete(`/api/base/${baseId}/connection`).expect(200);
    const result = await request.get(`/api/base/${baseId}/connection`).expect(200);
    expect(result.body).toEqual({});
  });
});
