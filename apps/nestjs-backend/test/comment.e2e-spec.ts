import type { INestApplication } from '@nestjs/common';
import type { IFieldVo, ISelectFieldOptions } from '@teable/core';
import { FieldType, ViewType, SortFunc } from '@teable/core';
import { createComment, CommentContentType, getCommentList } from '@teable/openapi';
import {
  createTable,
  createView,
  deleteField,
  deleteTable,
  initApp,
  getViews,
  convertField,
} from './utils/init-app';

describe('OpenAPI CommentController (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let tableId: string;
  let recordId: string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const { id, records } = await createTable(baseId, { name: 'table' });
    tableId = id;
    recordId = records[0].id;
  });
  afterEach(async () => {
    await deleteTable(baseId, tableId);
  });

  // todo
  it('should get a comment list', async () => {});

  // todo
  it.only('should create a new comment', async () => {});

  // todo
  it('should delete comment', async () => {});

  // todo
  it('should update comment', async () => {});
});
