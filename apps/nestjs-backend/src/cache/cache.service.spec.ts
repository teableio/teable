/* eslint-disable @typescript-eslint/no-explicit-any */
import type Keyv from 'keyv';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheService } from './cache.service';

describe('CacheService.getMany', () => {
  let keyv: { get: ReturnType<typeof vi.fn> };
  let service: CacheService;

  beforeEach(() => {
    keyv = { get: vi.fn().mockResolvedValue([]) };
    service = new CacheService(keyv as unknown as Keyv<any>);
  });

  it('short-circuits an empty key list without hitting the store', async () => {
    expect(await service.getMany([])).toEqual([]);
    expect(keyv.get).not.toHaveBeenCalled();
  });

  it('forwards a non-empty key list to the store', async () => {
    keyv.get.mockResolvedValue(['a-value', undefined]);
    expect(await service.getMany(['a', 'b'] as any)).toEqual(['a-value', undefined]);
    expect(keyv.get).toHaveBeenCalledWith(['a', 'b']);
  });
});
