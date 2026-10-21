import type { INestApplication } from '@nestjs/common';
import { ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { IPinEntryMapVo, IGetPinListVo, IUserMeVo } from '@teable/openapi';
import {
  ADD_PIN,
  addPin,
  deletePin,
  deleteView,
  GET_PIN_ENTRY_MAP,
  GET_PIN_LIST,
  getPinList,
  PinType,
  updatePinOrder,
  USER_ME,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
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

  // pentest IDOR-VULN-02: a pin must not read the name of something the caller cannot open.
  describe('resources of another tenant', () => {
    let outsider: AxiosInstance;
    let outsiderId: string;

    beforeAll(async () => {
      outsider = await createNewUserAxios({
        email: `pin-outsider-${Date.now()}@test-pin.com`,
        password: '12345678a',
      });
      outsiderId = (await outsider.get<IUserMeVo>(USER_ME)).data.id;
    });

    it('cannot pin them, and an unknown id is refused the same way', async () => {
      const targets = [
        { id: spaceId, type: PinType.Space },
        { id: baseId, type: PinType.Base },
        { id: tableId, type: PinType.Table },
        { id: viewId, type: PinType.View },
        { id: 'bseNotExist0000000', type: PinType.Base },
      ];
      for (const target of targets) {
        const error = await getError(() => outsider.post(ADD_PIN, target));
        expect(error?.status).toBe(404);
      }
      expect((await outsider.get<IGetPinListVo>(GET_PIN_LIST)).data).toEqual([]);
    });

    it('never lists or resolves a pin row that points at them', async () => {
      const prisma = app.get(PrismaService);
      await prisma.pinResource.createMany({
        data: [
          { type: PinType.Base, resourceId: baseId, createdBy: outsiderId, order: 1 },
          { type: PinType.Table, resourceId: tableId, createdBy: outsiderId, order: 2 },
        ],
      });
      try {
        expect((await outsider.get<IGetPinListVo>(GET_PIN_LIST)).data).toEqual([]);
        expect((await outsider.get<IPinEntryMapVo>(GET_PIN_ENTRY_MAP)).data).toEqual({});
      } finally {
        await prisma.pinResource.deleteMany({ where: { createdBy: outsiderId } });
      }
    });
  });
});
