import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '@teable/db-main-prisma';
import type { CacheService } from '../../cache/cache.service';
import type { IOAuthDeviceState } from '../../cache/types';
import type { IOAuthConfig } from '../../configs/oauth.config';
import { CustomHttpException } from '../../custom.exception';
import type { DistributedLockService } from '../../distributed-lock';
import type { DeviceAuthorizationError } from './oauth-device.service';
import { OAuthDeviceService } from './oauth-device.service';

const CLIENT_ID = 'clttckxmg4deadomjhs';
const APP_SCOPES = ['record|read', 'record|update'];
const USER = { id: 'usr1', name: 'Boris', email: 'boris@teable.io' };

/**
 * A map is closer to the real thing than a mock here: these tests are about
 * what the two cache entries hold and when they disappear. `del` returning
 * whether the key existed, `setnx` refusing an existing key, and setnx-written
 * keys being readable via `get` all mirror the real CacheService (the last of
 * these only since setnx started writing the keyv envelope — its raw-layout
 * era is what this shared map could not have caught).
 */
function createCache() {
  const store = new Map<string, unknown>();
  const cache = {
    get: async (key: string) => store.get(key),
    set: async (key: string, value: unknown) => void store.set(key, value),
    setDetail: async (key: string, value: unknown) => void store.set(key, value),
    del: async (key: string) => store.delete(key),
    setnx: async (key: string, value: unknown) => {
      if (store.has(key)) {
        return false;
      }
      store.set(key, value);
      return true;
    },
    incr: async (key: string) => {
      const next = ((store.get(key) as number | undefined) ?? 0) + 1;
      store.set(key, next);
      return next;
    },
  };
  return { store, cache: cache as unknown as CacheService };
}

describe('OAuthDeviceService', () => {
  let service: OAuthDeviceService;
  let store: Map<string, unknown>;
  let cache: CacheService;
  const findUnique = vitest.fn();
  const prismaService = {
    txClient: () => ({ oAuthApp: { findUnique } }),
  } as unknown as PrismaService;
  const config = {
    deviceCodeExpireIn: '15m',
    deviceCodeInterval: 5,
    deviceCodeRateLimit: 30,
    tokenRateWindow: '15m',
  } as IOAuthConfig;

  // Lock stub: run the guarded task immediately, as if the lock were acquired.
  const runExclusive = vitest.fn(async (_name: string, _ttl: number, task: () => Promise<void>) => {
    await task();
    return true;
  });
  const distributedLock = { runExclusive } as unknown as DistributedLockService;

  beforeEach(() => {
    const created = createCache();
    store = created.store;
    cache = created.cache;
    findUnique.mockResolvedValue({
      clientId: CLIENT_ID,
      name: 'Teable CLI',
      description: 'Official CLI',
      homepage: 'https://example.com',
      logo: null,
      scopes: JSON.stringify(APP_SCOPES),
      allowDeviceFlow: true,
    });
    service = new OAuthDeviceService(prismaService, created.cache, distributedLock, config);
  });

  afterEach(() => {
    vitest.clearAllMocks();
  });

  const request = () =>
    service.requestDeviceCode({
      clientId: CLIENT_ID,
      origin: 'https://app.example.com',
      ip: '203.0.113.7',
    });

  /**
   * The Map-backed cache never expires keys, so "the client waited out the
   * poll interval" is modeled by dropping the pacing key by hand.
   */
  const elapsePollInterval = (deviceCode: string) =>
    store.delete(`oauth:device-poll:${deviceCode}`);

  describe('requestDeviceCode', () => {
    it('hands out a typeable user code and a URL on the caller`s own origin', async () => {
      const result = await request();

      expect(result.userCode).toMatch(/^[BCDFGHJKMNP-TVWXZ]{4}-[BCDFGHJKMNP-TVWXZ]{4}$/);
      expect(result.verificationUri).toBe('https://app.example.com/oauth/device');
      expect(result.expiresIn).toBe(900);
      expect(result.interval).toBe(5);
      // The user code is only an index; the state lives under the device code.
      expect(store.get(`oauth:device-user:${result.userCode}`)).toBe(result.deviceCode);
      expect(store.get(`oauth:device:${result.deviceCode}`)).toMatchObject({
        clientId: CLIENT_ID,
        status: 'pending',
        scopes: APP_SCOPES,
      });
    });

    it('rejects scopes the app was never granted', async () => {
      await expect(
        service.requestDeviceCode({
          clientId: CLIENT_ID,
          origin: 'https://app.example.com',
          ip: '203.0.113.7',
          scopes: ['table|delete'],
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses an app that has not opted in to the device flow', async () => {
      findUnique.mockResolvedValue({
        clientId: CLIENT_ID,
        name: 'No Device App',
        homepage: 'https://example.com',
        logo: null,
        scopes: JSON.stringify(APP_SCOPES),
        allowDeviceFlow: false,
      });

      await expect(request()).rejects.toThrow(
        'This app has not enabled the device authorization flow'
      );
    });

    it('rate limits an address that asks too often', async () => {
      store.set('oauth:device-rate:203.0.113.7', config.deviceCodeRateLimit);

      await expect(request()).rejects.toThrow(CustomHttpException);
      // Another address is unaffected — the limit is per IP.
      await expect(
        service.requestDeviceCode({
          clientId: CLIENT_ID,
          origin: 'https://app.example.com',
          ip: '203.0.113.8',
        })
      ).resolves.toMatchObject({ userCode: expect.any(String) });
    });

    it('rerolls the user code instead of overwriting a colliding flow', async () => {
      const generate = vitest
        .spyOn(service as unknown as { generateUserCode: () => string }, 'generateUserCode')
        .mockReturnValueOnce('BBBB-BBBB')
        .mockReturnValueOnce('BBBB-BBBB')
        .mockReturnValueOnce('CCCC-CCCC');

      const first = await request();
      const second = await request();

      expect(first.userCode).toBe('BBBB-BBBB');
      expect(second.userCode).toBe('CCCC-CCCC');
      expect(generate).toHaveBeenCalledTimes(3);
      // The earlier flow keeps its index; the collision cost only a reroll.
      expect(store.get('oauth:device-user:BBBB-BBBB')).toBe(first.deviceCode);
      expect(store.get('oauth:device-user:CCCC-CCCC')).toBe(second.deviceCode);
    });
  });

  describe('user code lookup', () => {
    it('accepts the code the way people type it back', async () => {
      const { userCode } = await request();

      // lower case, spaces instead of the dash, no separator at all
      for (const typed of [
        userCode.toLowerCase(),
        userCode.replace('-', ' '),
        userCode.replace('-', ''),
      ]) {
        await expect(service.getDeviceApp(typed)).resolves.toMatchObject({ name: 'Teable CLI' });
      }
    });

    it('refuses a code nobody issued', async () => {
      await expect(service.getDeviceApp('ZZZZ-ZZZZ')).rejects.toThrow(NotFoundException);
    });
  });

  describe('poll', () => {
    it('answers pending before approval and slow_down to a client that races back', async () => {
      const { deviceCode } = await request();

      await expect(service.poll(deviceCode, CLIENT_ID)).resolves.toEqual({ status: 'pending' });
      await expect(service.poll(deviceCode, CLIENT_ID)).resolves.toEqual({ status: 'slow_down' });
    });

    it('never writes the state back on a pending poll, so it cannot clobber an approval', async () => {
      const { deviceCode } = await request();
      const before = store.get(`oauth:device:${deviceCode}`);

      await service.poll(deviceCode, CLIENT_ID);

      // Same object, untouched: an approval written by decide() between this
      // poll's read and its return has nothing that can overwrite it.
      expect(store.get(`oauth:device:${deviceCode}`)).toBe(before);
    });

    it('returns the approver once someone approves, and consumes the code', async () => {
      const { deviceCode, userCode } = await request();
      await service.decide({ userCode, approve: true, user: USER });

      const result = await service.poll(deviceCode, CLIENT_ID);
      expect(result).toMatchObject({ status: 'approved', state: { user: USER } });

      // Single-use: both entries are gone, so a replay looks like an expiry.
      expect(store.get(`oauth:device:${deviceCode}`)).toBeUndefined();
      expect(store.get(`oauth:device-user:${userCode}`)).toBeUndefined();
      await expect(service.poll(deviceCode, CLIENT_ID)).resolves.toEqual({ status: 'expired' });
    });

    it('reports a denial once and then forgets the code', async () => {
      const { deviceCode, userCode } = await request();
      await service.decide({ userCode, approve: false, user: USER });

      await expect(service.poll(deviceCode, CLIENT_ID)).resolves.toEqual({ status: 'denied' });
      await expect(service.poll(deviceCode, CLIENT_ID)).resolves.toEqual({ status: 'expired' });
    });

    it('refuses a device code polled by a different client', async () => {
      const { deviceCode } = await request();

      await expect(service.poll(deviceCode, 'someone-else')).resolves.toEqual({
        status: 'expired',
      });
    });

    it('expires on its own deadline even if the entry outlives its ttl', async () => {
      const { deviceCode } = await request();
      const state = store.get(`oauth:device:${deviceCode}`) as { expiresAt: number };
      store.set(`oauth:device:${deviceCode}`, { ...state, expiresAt: Date.now() - 1 });

      await expect(service.poll(deviceCode, CLIENT_ID)).resolves.toEqual({ status: 'expired' });
    });

    it('yields when a concurrent poll claimed the approval first', async () => {
      const { deviceCode, userCode } = await request();
      await service.decide({ userCode, approve: true, user: USER });

      // Interleaving: this poll reads the approved state, but by the time it
      // tries to delete, a concurrent poll has already claimed the entry — the
      // failed delete must mean no tokens, not a second grant.
      vitest.spyOn(cache, 'del').mockResolvedValueOnce(false);

      await expect(service.poll(deviceCode, CLIENT_ID)).resolves.toEqual({ status: 'expired' });
    });
  });

  describe('restore', () => {
    it('puts a claimed approval back so the next poll can retry', async () => {
      const { deviceCode, userCode } = await request();
      await service.decide({ userCode, approve: true, user: USER });

      const claimed = await service.poll(deviceCode, CLIENT_ID);
      expect(claimed.status).toBe('approved');
      expect(store.get(`oauth:device:${deviceCode}`)).toBeUndefined();

      // Token issuance failed after the claim; the approval must survive it.
      await service.restore(deviceCode, (claimed as { state: IOAuthDeviceState }).state);

      elapsePollInterval(deviceCode);
      const retried = await service.poll(deviceCode, CLIENT_ID);
      expect(retried).toMatchObject({ status: 'approved', state: { user: USER } });
      expect(store.get(`oauth:device-user:${userCode}`)).toBeUndefined();
    });
  });

  describe('decide', () => {
    it('cannot be replayed on a code that was already decided', async () => {
      const { userCode } = await request();
      await service.decide({ userCode, approve: true, user: USER });

      await expect(service.decide({ userCode, approve: false, user: USER })).rejects.toThrow(
        BadRequestException
      );
    });

    it('turns away a decision racing one already in flight', async () => {
      const { userCode } = await request();
      // The lock is held: runExclusive skips the task and reports it.
      runExclusive.mockResolvedValueOnce(false);

      await expect(service.decide({ userCode, approve: true, user: USER })).rejects.toThrow(
        'This code has already been used'
      );
      // The code is untouched and the real decision can still land.
      await expect(service.decide({ userCode, approve: true, user: USER })).resolves.toEqual({
        clientId: CLIENT_ID,
      });
    });
  });

  describe('RFC 8628 error codes on the device authorization endpoint', () => {
    const rfcErrorOf = (promise: Promise<unknown>) =>
      promise.then(
        () => undefined,
        (error) => (error as DeviceAuthorizationError).rfcError
      );

    it('names the refusal the way the RFC does', async () => {
      findUnique.mockResolvedValueOnce(null);
      await expect(rfcErrorOf(request())).resolves.toBe('invalid_client');

      findUnique.mockResolvedValueOnce({
        clientId: CLIENT_ID,
        name: 'No Device App',
        homepage: 'https://example.com',
        logo: null,
        scopes: JSON.stringify(APP_SCOPES),
        allowDeviceFlow: false,
      });
      await expect(rfcErrorOf(request())).resolves.toBe('unauthorized_client');

      await expect(
        rfcErrorOf(
          service.requestDeviceCode({
            clientId: CLIENT_ID,
            origin: 'https://app.example.com',
            ip: '203.0.113.7',
            scopes: ['table|delete'],
          })
        )
      ).resolves.toBe('invalid_scope');
    });
  });

  describe('expiry on the approval side', () => {
    it('treats a state past its expiresAt as gone, even if the cache kept it', async () => {
      const { deviceCode, userCode } = await request();
      const state = store.get(`oauth:device:${deviceCode}`) as IOAuthDeviceState;
      store.set(`oauth:device:${deviceCode}`, { ...state, expiresAt: Date.now() - 1 });

      await expect(service.getDeviceApp(userCode)).rejects.toThrow(NotFoundException);
      // Forgotten on sight, so the entries cannot linger past their clock.
      expect(store.get(`oauth:device:${deviceCode}`)).toBeUndefined();
      expect(store.get(`oauth:device-user:${userCode}`)).toBeUndefined();
    });
  });

  describe('owner turns the device flow off while a code is in flight', () => {
    const disableDeviceFlow = () =>
      findUnique.mockResolvedValue({
        clientId: CLIENT_ID,
        name: 'Teable CLI',
        homepage: 'https://example.com',
        logo: null,
        scopes: JSON.stringify(APP_SCOPES),
        allowDeviceFlow: false,
      });

    it('hides the approval page', async () => {
      const { userCode } = await request();
      disableDeviceFlow();

      await expect(service.getDeviceApp(userCode)).rejects.toThrow(ForbiddenException);
    });

    it('refuses new approvals', async () => {
      const { userCode } = await request();
      disableDeviceFlow();

      await expect(service.decide({ userCode, approve: true, user: USER })).rejects.toThrow(
        ForbiddenException
      );
    });

    it('denies an approval that predates the flip, and consumes the code', async () => {
      const { deviceCode, userCode } = await request();
      await service.decide({ userCode, approve: true, user: USER });
      disableDeviceFlow();

      await expect(service.poll(deviceCode, CLIENT_ID)).resolves.toEqual({ status: 'denied' });
      expect(store.get(`oauth:device:${deviceCode}`)).toBeUndefined();
      expect(store.get(`oauth:device-user:${userCode}`)).toBeUndefined();
    });

    it('keeps the approval when the toggle lookup fails transiently', async () => {
      const { deviceCode, userCode } = await request();
      await service.decide({ userCode, approve: true, user: USER });
      findUnique.mockRejectedValueOnce(new Error('connection reset'));

      await expect(service.poll(deviceCode, CLIENT_ID)).rejects.toThrow('connection reset');
      // Not consumed as denied: the next poll can still succeed.
      elapsePollInterval(deviceCode);
      await expect(service.poll(deviceCode, CLIENT_ID)).resolves.toMatchObject({
        status: 'approved',
      });
    });
  });
});
