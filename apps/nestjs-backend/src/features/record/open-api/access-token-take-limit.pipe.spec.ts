import type { ClsService } from 'nestjs-cls';
import type { IBaseConfig } from '../../../configs/base.config';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import type { AccessTokenModel } from '../../model/access-token';
import {
  AccessTokenTakeLimitPipe,
  CLOUD_ACCESS_TOKEN_TAKE_LIMIT,
  CLOUD_ACCESS_TOKEN_TAKE_LIMIT_SINCE,
} from './access-token-take-limit.pipe';

describe('AccessTokenTakeLimitPipe', () => {
  const since = CLOUD_ACCESS_TOKEN_TAKE_LIMIT_SINCE;
  const over = { take: CLOUD_ACCESS_TOKEN_TAKE_LIMIT + 1 };

  const build = (opts: {
    isCloud?: boolean;
    accessTokenId?: string;
    token?: { clientId: string | null; createdTime: string } | null;
  }) => {
    const lookup = vi.fn().mockResolvedValue(opts.token ?? null);
    const pipe = new AccessTokenTakeLimitPipe(
      { get: () => opts.accessTokenId } as unknown as ClsService<IClsStore>,
      { getAccessTokenRawById: lookup } as unknown as AccessTokenModel,
      { isCloud: opts.isCloud ?? true } as IBaseConfig
    );
    return { pipe, lookup };
  };

  it('rejects take above the cap for a personal token created at or after the cutoff', async () => {
    const { pipe } = build({
      accessTokenId: 'tok',
      token: { clientId: null, createdTime: since.toISOString() },
    });
    await expect(pipe.transform(over)).rejects.toThrow(CustomHttpException);
  });

  it('leaves tokens created before the cutoff and client-issued tokens uncapped', async () => {
    const before = new Date(since.getTime() - 1).toISOString();
    await expect(
      build({
        accessTokenId: 'tok',
        token: { clientId: null, createdTime: before },
      }).pipe.transform(over)
    ).resolves.toEqual(over);
    await expect(
      build({
        accessTokenId: 'tok',
        token: { clientId: 'client', createdTime: since.toISOString() },
      }).pipe.transform(over)
    ).resolves.toEqual(over);
  });

  it('never looks the token up when the request is within the cap, session-authed, or not cloud', async () => {
    const within = { take: CLOUD_ACCESS_TOKEN_TAKE_LIMIT };
    for (const { pipe, lookup } of [
      build({ accessTokenId: 'tok' }),
      build({ accessTokenId: undefined }),
      build({ accessTokenId: 'tok', isCloud: false }),
    ]) {
      await expect(pipe.transform(within)).resolves.toEqual(within);
      expect(lookup).not.toHaveBeenCalled();
    }
    const session = build({ accessTokenId: undefined });
    await expect(session.pipe.transform(over)).resolves.toEqual(over);
    expect(session.lookup).not.toHaveBeenCalled();
  });
});
