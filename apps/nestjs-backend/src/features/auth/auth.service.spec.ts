/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../global/global.module';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';

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
