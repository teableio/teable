import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { FieldType } from '@teable/core';
import type { IViewVo, IShareViewMeta } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { createViewVoByRaw } from '../view/model/factory';

export interface IShareViewInfo {
  shareId: string;
  tableId: string;
  view?: IViewVo;
}

export interface IJwtShareInfo {
  shareId: string;
  password: string;
}

@Injectable()
export class ShareAuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async validateJwtToken(token: string) {
    try {
      return await this.jwtService.verifyAsync<IJwtShareInfo>(token);
    } catch {
      throw new UnauthorizedException();
    }
  }

  async authShareView(shareId: string, pass: string): Promise<string | null> {
    const view = await this.prismaService.view.findFirst({
      where: { shareId, enableShare: true, deletedTime: null },
      select: { shareId: true, shareMeta: true },
    });
    if (!view) {
      return null;
    }
    const shareMeta = view.shareMeta ? (JSON.parse(view.shareMeta) as IShareViewMeta) : undefined;
    const password = shareMeta?.password;
    if (!password) {
      throw new BadRequestException('Password restriction is not enabled');
    }
    return pass === password ? shareId : null;
  }

  async authToken(jwtShareInfo: IJwtShareInfo) {
    return await this.jwtService.signAsync(jwtShareInfo);
  }

  async getShareViewInfo(shareId: string): Promise<IShareViewInfo> {
    const view = await this.prismaService.view.findFirst({
      where: { shareId, enableShare: true, deletedTime: null },
    });
    if (!view) {
      throw new BadRequestException('share view not found');
    }

    return {
      shareId,
      tableId: view.tableId,
      view: createViewVoByRaw(view),
    };
  }

  async getLinkViewInfo(linkFieldId: string): Promise<IShareViewInfo> {
    const userId = this.cls.get('user.id');
    const fieldRaw = await this.prismaService.field
      .findFirstOrThrow({
        where: { id: linkFieldId, deletedTime: null },
      })
      .catch((_err) => {
        throw new NotFoundException(`Field ${linkFieldId} not exist`);
      });

    const field = createFieldInstanceByRaw(fieldRaw);

    if (field.type !== FieldType.Link) {
      throw new BadRequestException('field is not a link field');
    }

    // TODO: check tableId permission for this user
    // if (!userId) {
    //   throw new ForbiddenException('user is required');
    // }

    return {
      shareId: linkFieldId,
      tableId: field.options.foreignTableId,
    };
  }
}
