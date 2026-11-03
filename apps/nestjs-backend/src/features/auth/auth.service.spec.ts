/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { ClsService } from 'nestjs-cls';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import { GlobalModule } from '../../global/global.module';
import type { IClsStore } from '../../types/cls';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';
import type { TeableJwtService } from './jwt/teable-jwt.service';
import type { PermissionService } from './permission.service';
import { JwtAuthInternalType } from './strategies/types';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, AuthModule],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

describe('AuthService.getTempInternalToken', () => {
  const jwtService = mockDeep<TeableJwtService>();
  const service = new AuthService(
    mockDeep<ClsService<IClsStore>>(),
    mockDeep<PermissionService>(),
    jwtService
  );

  beforeEach(() => {
    mockReset(jwtService);
    jwtService.signAsync.mockResolvedValue('token');
  });

  it('gives every App token its own jti', async () => {
    await service.getTempInternalToken('bse1', JwtAuthInternalType.App, '10y');
    await service.getTempInternalToken('bse1', JwtAuthInternalType.App, '10y');

    const [first, second] = jwtService.signAsync.mock.calls.map(([, options]) => options?.jwtid);
    expect(first).toEqual(expect.any(String));
    expect(second).toEqual(expect.any(String));
    expect(first).not.toBe(second);
  });

  it('leaves other internal tokens without a jti', async () => {
    await service.getTempInternalToken('bse1', JwtAuthInternalType.Automation);

    expect(jwtService.signAsync.mock.calls[0][1]).toEqual({ expiresIn: '10m' });
  });
});
