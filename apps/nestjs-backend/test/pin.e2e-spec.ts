import type { INestApplication } from '@nestjs/common';
import { ViewType } from '@teable/core';
import {
  addPin,
  deletePin,
  deleteView,
  getPinList,
  PinType,
  updatePinOrder,
} from '@teable/openapi';
import {
  createBase,
  createSpace,
  createTable,
  createView,
  initApp,
  permanentDeleteBase,
  permanentDeleteSpace,
  permanentDeleteTable,
} from './utils/init-app';

describe('OpenAPI PinController (e2e)', () => {
  let app: INestApplication;
  let spaceId: string;
  let baseId: string;
  let tableId: string;
  let viewId: string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const spaceRes = await createSpace({
      name: 'test-space',
    });
    spaceId = spaceRes.id;

    const baseRes = await createBase({
      name: 'test-base',
      spaceId,
    });
    baseId = baseRes.id;

    const tableRes = await createTable(baseId, {
      name: 'test-table',
    });
    tableId = tableRes.id;

    const viewRes = await createView(tableId, {
      name: 'test-view',
      type: ViewType.Grid,
    });
    viewId = viewRes.id;

    const pinBaseRes = await addPin({
      id: baseId,
      type: PinType.Base,
    });
    expect(pinBaseRes.status).toBe(201);
    const pinSpaceRes = await addPin({
      id: spaceId,
      type: PinType.Space,
    });
    expect(pinSpaceRes.status).toBe(201);
    const pinTableRes = await addPin({
      id: tableId,
      type: PinType.Table,
    });
    expect(pinTableRes.status).toBe(201);
    const pinViewRes = await addPin({
      id: viewId,
      type: PinType.View,
    });
    expect(pinViewRes.status).toBe(201);
  });

  afterEach(async () => {
    const pinBaseRes = await deletePin({
      id: baseId,
      type: PinType.Base,
    });
    expect(pinBaseRes.status).toBe(200);
    const pinSpaceRes = await deletePin({
      id: spaceId,
      type: PinType.Space,
    });
    expect(pinSpaceRes.status).toBe(200);
    const pinTableRes = await deletePin({
      id: tableId,
      type: PinType.Table,
    });
    expect(pinTableRes.status).toBe(200);
    const pinViewRes = await deletePin({
      id: viewId,
      type: PinType.View,
    });
    expect(pinViewRes.status).toBe(200);
    await deleteView(tableId, viewId);
    await permanentDeleteTable(baseId, tableId);
    await permanentDeleteBase(baseId);
    await permanentDeleteSpace(spaceId);
  });

  it('should be able to get pin list', async () => {
    const pinRes = await getPinList();
    expect(pinRes.status).toBe(200);
    expect(pinRes.data.length).toBe(4);
    expect(pinRes.data).toEqual([
      {
        id: baseId,
        type: PinType.Base,
        order: 1,
        name: 'test-base',
      },
      {
        id: spaceId,
        type: PinType.Space,
        order: 2,
        name: 'test-space',
      },
      {
        id: tableId,
        type: PinType.Table,
        order: 3,
        name: 'test-table',
        parentBaseId: baseId,
      },
      {
        id: viewId,
        type: PinType.View,
        order: 4,
        name: 'test-view',
        parentBaseId: baseId,
        viewMeta: {
          type: ViewType.Grid,
          tableId,
        },
      },
    ]);
  });

  it('should be able to update pin order', async () => {
    await updatePinOrder({
      id: tableId,
      type: PinType.Table,
      anchorId: baseId,
      anchorType: PinType.Base,
      position: 'before',
    });
    const pinRes = await getPinList();
    expect(pinRes.status).toBe(200);
    expect(pinRes.data.map((pin) => pin.id)).toEqual([tableId, baseId, spaceId, viewId]);
  });
});
