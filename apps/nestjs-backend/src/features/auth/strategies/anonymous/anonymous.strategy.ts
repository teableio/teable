import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ANONYMOUS_USER } from '@teable/core';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../../types/cls';
import { PassportAnonymousStrategy } from './anonymous.passport';

@Injectable()
export class AnonymousStrategy extends PassportStrategy(PassportAnonymousStrategy) {
  constructor(private readonly cls: ClsService<IClsStore>) {
    super();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async validate() {
    this.cls.set('user', ANONYMOUS_USER);
    return ANONYMOUS_USER;
  }
}
