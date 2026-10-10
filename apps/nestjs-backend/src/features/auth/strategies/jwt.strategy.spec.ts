import { UnauthorizedException } from '@nestjs/common';
import { AUTOMATION_ROBOT_USER } from '@teable/core';
import type { Request } from 'express';
import type { ClsService } from 'nestjs-cls';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import type { IClsStore } from '../../../types/cls';
import type { UserService } from '../../user/user.service';
import type { TeableJwtService } from '../jwt/teable-jwt.service';
import { JwtStrategy } from './jwt.strategy';
import type { IJwtAuthInternalInfo } from './types';
import { JwtAuthInternalType } from './types';

describe('JwtStrategy', () => {
  const teableJwtService = mockDeep<TeableJwtService>();
  const userService = mockDeep<UserService>();
  const cls = mockDeep<ClsService<IClsStore>>();
  const req = {} as Request;
  let strategy: JwtStrategy;

  beforeEach(() => {
    teableJwtService.passportSecretProvider.mockReturnValue((_req, _raw, done) =>
      done(null, 'secret')
    );
    strategy = new JwtStrategy(teableJwtService, userService, cls);
  });

  afterEach(() => {
    mockReset(teableJwtService);
    mockReset(userService);
    mockReset(cls);
  });

  const validate = (payload: unknown) => strategy.validate(req, payload as IJwtAuthInternalInfo);

  it('rejects a base-scoped payload without an internal type', async () => {
    await expect(validate({ baseId: 'bseVictim' })).rejects.toThrow(UnauthorizedException);
    expect(cls.set).not.toHaveBeenCalledWith('tempAuthBaseId', expect.anything());
    expect(cls.set).not.toHaveBeenCalledWith('user', expect.anything());
  });

  it('rejects a base-scoped payload with an unknown internal type', async () => {
    await expect(validate({ baseId: 'bseVictim', type: 'owner' })).rejects.toThrow(
      UnauthorizedException
    );
    expect(cls.set).not.toHaveBeenCalledWith('tempAuthBaseId', expect.anything());
  });

  it('rejects an automation payload whose workflow context is malformed', async () => {
    await expect(
      validate({
        baseId: 'bseVictim',
        type: JwtAuthInternalType.Automation,
        context: { actionId: 1 },
      })
    ).rejects.toThrow(UnauthorizedException);
  });

  it('accepts a well-formed automation payload and scopes it to the base', async () => {
    const context = { actionId: 'act1', workflowId: 'wfl1', workflowName: 'flow' };
    const user = await validate({
      baseId: 'bseOwn',
      type: JwtAuthInternalType.Automation,
      context,
      iat: 1,
      exp: 2,
    });
    expect(user).toEqual(AUTOMATION_ROBOT_USER);
    expect(cls.set).toHaveBeenCalledWith('tempAuthBaseId', 'bseOwn');
    expect(cls.set).toHaveBeenCalledWith('workflowContext', context);
  });

  it('still resolves an ordinary user token', async () => {
    userService.getUserById.mockResolvedValue({
      id: 'usr1',
      name: 'u',
      email: 'u@example.com',
      isAdmin: false,
      notifyMeta: '{}',
    } as never);
    const user = await validate({ userId: 'usr1' });
    expect(user).toMatchObject({ id: 'usr1' });
    expect(cls.set).toHaveBeenCalledWith('user.id', 'usr1');
  });
});
