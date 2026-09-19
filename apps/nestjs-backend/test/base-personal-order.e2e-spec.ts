/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import {
  axios,
  BASE_PERSONAL_ORDER,
  createAccessToken,
  createAxios,
  createBase,
  createSpace,
  deleteAccessToken,
  GET_BASE_ALL,
  getBaseAll,
  LastVisitResourceType,
  moveBase,
  permanentDeleteBase,
  RESET_BASE_PERSONAL_ORDER,
  resetBasePersonalOrder,
  updateBasePersonalOrder,
  urlBuilder,
} from '@teable/openapi';
import { getError } from './utils/get-error';
import { initApp, permanentDeleteSpace } from './utils/init-app';

/**
 * Per-user base ordering (T7235): `GET /base/access/all?orderBy=personal` lists bases the
 * way the caller arranged them, falling back to last-visit recency until the first move.
 */
describe('Base personal order (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userId: string;
  let spaceId: string;
  let baseA: string;
  let baseB: string;
  let baseC: string;

  beforeAll(async () => {
    const ctx = await initApp();
    app = ctx.app;
    prisma = app.get<PrismaService>(PrismaService);
    userId = globalThis.testConfig.userId;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    spaceId = (await createSpace({ name: 'personal-order-space' })).data.id;
    baseA = (await createBase({ spaceId, name: 'A' })).data.id;
    baseB = (await createBase({ spaceId, name: 'B' })).data.id;
    baseC = (await createBase({ spaceId, name: 'C' })).data.id;
    // Every test starts from "never opened"; visits are set explicitly where they matter.
    await Promise.all([baseA, baseB, baseC].map(forget));
  });

  afterEach(async () => {
    for (const baseId of [baseA, baseB, baseC]) {
      await permanentDeleteBase(baseId).catch(() => undefined);
    }
    await permanentDeleteSpace(spaceId);
  });

  const visit = (baseId: string, at: Date) =>
    prisma.userLastVisit.upsert({
      where: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        userId_resourceType_resourceId: {
          userId,
          resourceType: LastVisitResourceType.Base,
          resourceId: baseId,
        },
      },
      create: {
        userId,
        resourceType: LastVisitResourceType.Base,
        resourceId: baseId,
        parentResourceId: spaceId,
        lastVisitTime: at,
      },
      update: { lastVisitTime: at },
    });

  // Creating a base records a visit, so drop the row when a test needs a never-visited base.
  const forget = (baseId: string) =>
    prisma.userLastVisit.deleteMany({
      where: { userId, resourceType: LastVisitResourceType.Base, resourceId: baseId },
    });

  const personalIds = async () =>
    (await getBaseAll({ orderBy: 'personal' })).data
      .filter((base) => base.spaceId === spaceId)
      .map((base) => base.id);

  const sharedIds = async () =>
    (await getBaseAll()).data.filter((base) => base.spaceId === spaceId).map((base) => base.id);

  it('starts from last-visit recency, never-visited bases last in the shared order', async () => {
    await visit(baseA, new Date('2026-09-01T00:00:00Z'));
    await visit(baseC, new Date('2026-09-02T00:00:00Z'));

    expect(await personalIds()).toEqual([baseC, baseA, baseB]);
    // The shared list (what everyone sees) is untouched by any of this.
    expect(await sharedIds()).toEqual([baseA, baseB, baseC]);
  });

  it('freezes the current order on the first move and stops following visits afterwards', async () => {
    await visit(baseA, new Date('2026-09-01T00:00:00Z'));
    await visit(baseC, new Date('2026-09-02T00:00:00Z'));
    expect(await personalIds()).toEqual([baseC, baseA, baseB]);

    await updateBasePersonalOrder({ baseId: baseB, anchorId: baseC, position: 'before' });

    expect(await personalIds()).toEqual([baseB, baseC, baseA]);
    const saved = (await getBaseAll({ orderBy: 'personal' })).data
      .filter((base) => base.spaceId === spaceId)
      .map((base) => base.personalOrder);
    expect(saved).toEqual([1, 2, 3]);

    // Visiting no longer reshuffles a frozen space.
    await visit(baseA, new Date('2026-09-09T00:00:00Z'));
    expect(await personalIds()).toEqual([baseB, baseC, baseA]);

    await updateBasePersonalOrder({ baseId: baseA, anchorId: baseB, position: 'after' });
    expect(await personalIds()).toEqual([baseB, baseA, baseC]);
    expect(await sharedIds()).toEqual([baseA, baseB, baseC]);
  });

  it('puts a base that joins a frozen space on top (creation counts as a visit), never-visited ones last', async () => {
    await updateBasePersonalOrder({ baseId: baseC, anchorId: baseA, position: 'before' });
    const baseD = (await createBase({ spaceId, name: 'D' })).data.id;
    try {
      expect(await personalIds()).toEqual([baseD, baseC, baseA, baseB]);
      // A base shared with the user that they never opened stays out of the way.
      await forget(baseD);
      expect(await personalIds()).toEqual([baseC, baseA, baseB, baseD]);
    } finally {
      await permanentDeleteBase(baseD);
    }
  });

  it('refuses an anchor from another space', async () => {
    const otherSpace = (await createSpace({ name: 'other-space' })).data.id;
    const otherBase = (await createBase({ spaceId: otherSpace, name: 'X' })).data.id;
    try {
      const error = await getError(() =>
        updateBasePersonalOrder({ baseId: baseA, anchorId: otherBase, position: 'before' })
      );
      expect(error?.status).toBe(400);
      expect(await prisma.userBaseOrder.count({ where: { userId } })).toBe(0);
    } finally {
      await permanentDeleteBase(otherBase);
      await permanentDeleteSpace(otherSpace);
    }
  });

  it('reset forgets the arrangement of that space only', async () => {
    await updateBasePersonalOrder({ baseId: baseC, anchorId: baseA, position: 'before' });
    await visit(baseB, new Date());
    expect(await personalIds()).toEqual([baseC, baseA, baseB]);

    await resetBasePersonalOrder(spaceId);

    expect(await prisma.userBaseOrder.count({ where: { userId, base: { spaceId } } })).toBe(0);
    // Back to recency: B was just opened; A and C were never opened, so shared order.
    expect(await personalIds()).toEqual([baseB, baseA, baseC]);
  });

  it('drops the rows with a purged base and with a base moved to another space', async () => {
    await updateBasePersonalOrder({ baseId: baseC, anchorId: baseA, position: 'before' });
    expect(await prisma.userBaseOrder.count({ where: { userId, baseId: baseC } })).toBe(1);

    await permanentDeleteBase(baseC);
    expect(await prisma.userBaseOrder.count({ where: { userId, baseId: baseC } })).toBe(0);

    const otherSpace = (await createSpace({ name: 'move-target' })).data.id;
    try {
      await moveBase(baseB, otherSpace);
      expect(await prisma.userBaseOrder.count({ where: { userId, baseId: baseB } })).toBe(0);
    } finally {
      await permanentDeleteBase(baseB).catch(() => undefined);
      await permanentDeleteSpace(otherSpace);
    }
  });

  it('keeps a base-scoped access token inside its range', async () => {
    const { data: token } = await createAccessToken({
      name: 'personal-order-scoped',
      scopes: ['base|read', 'base|read_all'],
      baseIds: [baseA],
      expiredTime: '2099-01-01',
    });
    // The session cookie would win over the header on the shared client: use a bare one.
    const tokenAxios = createAxios();
    tokenAxios.defaults.baseURL = axios.defaults.baseURL;
    tokenAxios.defaults.headers.common.Authorization = `Bearer ${token.token}`;
    const otherSpace = (await createSpace({ name: 'outside-token' })).data.id;
    try {
      // The token sees base A only, like the list it reads...
      const { data: visible } = await tokenAxios.get(GET_BASE_ALL, {
        params: { orderBy: 'personal' },
      });
      expect(visible.map((base: { id: string }) => base.id)).toEqual([baseA]);
      // ...so a sibling outside the range is not a valid anchor, and rows are not rewritten.
      const moveError = await getError(() =>
        tokenAxios.put(urlBuilder(BASE_PERSONAL_ORDER, { baseId: baseA }), {
          anchorId: baseB,
          position: 'before',
        })
      );
      expect(moveError?.status).toBe(400);
      expect(await prisma.userBaseOrder.count({ where: { userId } })).toBe(0);
      // A space the token cannot see cannot be reset either.
      const resetError = await getError(() =>
        tokenAxios.delete(urlBuilder(RESET_BASE_PERSONAL_ORDER, { spaceId: otherSpace }))
      );
      expect(resetError?.status).toBe(404);
    } finally {
      await deleteAccessToken(token.id);
      await permanentDeleteSpace(otherSpace);
    }
  });
});
