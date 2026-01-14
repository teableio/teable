import type { INestApplication } from '@nestjs/common';
import type { IGetBaseVo } from '@teable/openapi';
import {
  getSetting,
  updateSetting,
  SettingKey,
  getBaseById,
  axios,
  urlBuilder,
  GET_BASE,
  X_CANARY_HEADER,
} from '@teable/openapi';
import { CanaryService } from '../src/features/canary';
import {
  createSpace,
  permanentDeleteSpace,
  permanentDeleteBase,
  createBase,
  initApp,
} from './utils/init-app';

describe('Canary Release (e2e)', () => {
  let app: INestApplication;
  let canaryService: CanaryService;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    canaryService = app.get(CanaryService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    // Reset canary config after each test
    await updateSetting({
      [SettingKey.CANARY_CONFIG]: {
        enabled: false,
        spaceIds: [],
      },
    });
  });

  describe('Canary Config CRUD via API', () => {
    it('should save and retrieve canary config', async () => {
      const testSpaceIds = ['spc123', 'spc456'];

      // Update canary config
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: true,
          spaceIds: testSpaceIds,
        },
      });

      // Retrieve and verify
      const res = await getSetting();
      expect(res.data.canaryConfig).toEqual({
        enabled: true,
        spaceIds: testSpaceIds,
      });
    });

    it('should update canary config enabled state', async () => {
      // First enable
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: true,
          spaceIds: ['spc123'],
        },
      });

      let res = await getSetting();
      expect(res.data.canaryConfig?.enabled).toBe(true);

      // Then disable
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: false,
          spaceIds: ['spc123'],
        },
      });

      res = await getSetting();
      expect(res.data.canaryConfig?.enabled).toBe(false);
    });
  });

  describe('Space Canary Status Check', () => {
    const testSpaceId = 'spcCanaryTest123';

    it('should return false when canary config is disabled', async () => {
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: false,
          spaceIds: [testSpaceId],
        },
      });

      const result = await canaryService.isSpaceInCanary(testSpaceId);
      expect(result).toBe(false);
    });

    it('should return false when space is not in canary list', async () => {
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: true,
          spaceIds: ['spcOther'],
        },
      });

      const result = await canaryService.isSpaceInCanary(testSpaceId);
      expect(result).toBe(false);
    });

    it('should return true when space is in canary list and config is enabled', async () => {
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: true,
          spaceIds: [testSpaceId, 'spcOther'],
        },
      });

      const result = await canaryService.isSpaceInCanary(testSpaceId);
      expect(result).toBe(true);
    });
  });

  describe('Base API isCanary Field', () => {
    let spaceId: string;
    let baseId: string;

    beforeAll(async () => {
      // Create a real space and base
      const space = await createSpace({ name: 'Canary Base API Test' });
      spaceId = space.id;

      const base = await createBase({ spaceId, name: 'Test Base' });
      baseId = base.id;
    });

    afterAll(async () => {
      if (baseId) {
        await permanentDeleteBase(baseId);
      }
      if (spaceId) {
        await permanentDeleteSpace(spaceId);
      }
    });

    it('should return isCanary: true when space is in canary', async () => {
      // Configure canary with the space
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: true,
          spaceIds: [spaceId],
        },
      });

      const res = await getBaseById(baseId);
      expect(res.data.isCanary).toBe(true);
    });

    it('should not include isCanary when space is not in canary', async () => {
      // Configure canary without the space
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: true,
          spaceIds: ['spcOther'],
        },
      });

      const res = await getBaseById(baseId);
      expect(res.data.isCanary).toBeUndefined();
    });

    it('should not include isCanary when canary is disabled', async () => {
      // Disable canary
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: false,
          spaceIds: [spaceId],
        },
      });

      const res = await getBaseById(baseId);
      expect(res.data.isCanary).toBeUndefined();
    });

    it('should return isCanary: true when header is set to true', async () => {
      const res = await axios.get<IGetBaseVo>(
        urlBuilder(GET_BASE, {
          baseId,
        }),
        {
          headers: {
            [X_CANARY_HEADER]: 'true',
          },
        }
      );
      expect(res.data.isCanary).toBe(true);
    });
  });
});
