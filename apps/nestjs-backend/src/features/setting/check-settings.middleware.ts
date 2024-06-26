import type { NestMiddleware } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { Request, Response, NextFunction } from 'express';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';

@Injectable()
export class CheckSettingsMiddleware implements NestMiddleware {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async use(_req: Request, _res: Response, next: NextFunction) {
    const setting = await this.prismaService.setting.findFirst({
      select: {
        disallowSignUp: true,
        disallowSpaceCreation: true,
      },
    });

    if (!setting) return next();

    const { disallowSignUp, disallowSpaceCreation } = setting;

    this.cls.set('setting.disallowSignUp', Boolean(disallowSignUp));

    this.cls.set('setting.disallowSpaceCreation', Boolean(disallowSpaceCreation));

    next();
  }
}
