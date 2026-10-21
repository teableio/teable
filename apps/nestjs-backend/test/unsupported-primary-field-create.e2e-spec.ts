import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IHttpError } from '@teable/core';
import { FieldType, Relationship } from '@teable/core';
import { createTable as apiCreateTable, getTableList } from '@teable/openapi';
import { createTable, initApp, permanentDeleteTable } from './utils/init-app';
import { getError } from './utils/get-error';

/**
 * T7771 / Y2814 — unsupported primary types stay a 400 with no new table.
 * The public error code must be the exact string VALIDATION_ERROR.
 */
describe('OpenAPI unsupported primary field on create table (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects checkbox, attachment, button, and link primaries with VALIDATION_ERROR and creates no table', async () => {
    const previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';
    const foreign = await createTable(baseId, {
      name: `T7771 foreign ${Date.now()}`,
      fields: [{ name: 'Name', type: FieldType.SingleLineText } as IFieldRo],
      records: [],
    });

    try {
      const baselineIds = new Set((await getTableList(baseId)).data.map((table) => table.id));
      const cases: IFieldRo[] = [
        { type: FieldType.Checkbox, name: '勾选' },
        { type: FieldType.Attachment, name: '附件' },
        { type: FieldType.Button, name: '按钮' },
        {
          type: FieldType.Link,
          name: '关联',
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: foreign.id,
          },
        },
      ];

      for (const field of cases) {
        const error = await getError(() =>
          apiCreateTable(baseId, { name: `T7771 ${field.type} ${Date.now()}`, fields: [field] })
        );
        const httpError = error as IHttpError;
        expect(httpError?.status).toBe(400);
        expect(httpError?.code).toBe('VALIDATION_ERROR');
        expect(httpError?.message).toBe(
          `Field type ${field.type} is not supported as primary field`
        );
      }

      const afterIds = new Set((await getTableList(baseId)).data.map((table) => table.id));
      expect(afterIds).toEqual(baselineIds);
    } finally {
      await permanentDeleteTable(baseId, foreign.id);
      if (previousForceV2All === undefined) {
        delete process.env.FORCE_V2_ALL;
      } else {
        process.env.FORCE_V2_ALL = previousForceV2All;
      }
    }
  });
});
