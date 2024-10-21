import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { FieldType } from '@teable/core';
import type { IViewVo, IShareViewMeta, ILinkFieldOptions } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { PermissionService } from '../auth/permission.service';
import { createFieldInstanceByRaw } from '../field/model/factory';
import { createViewVoByRaw } from '../view/model/factory';

export interface IShareViewInfo {
  shareId: string;
  tableId: string;
  view?: IViewVo;
  linkOptions?: Pick<ILinkFieldOptions, 'filterByViewId' | 'visibleFieldIds' | 'filter'>;
  shareMeta?: IShareViewMeta;
}

export interface IJwtShareInfo {
  shareId: string;
  password: string;
}

@Injectable()
export class ShareAuthService {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService
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
    const viewVo = createViewVoByRaw(view);
    return {
      shareId,
      tableId: view.tableId,
      view: createViewVoByRaw(view),
      shareMeta: viewVo.shareMeta,
    };
  }

  async getLinkViewInfo(linkFieldId: string): Promise<IShareViewInfo> {
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

    // make sure user has permission to access the table where the link field from
    await this.permissionService.validPermissions(fieldRaw.tableId, [
      'table|read',
      'record|read',
      'field|read',
    ]);

    const { filterByViewId, visibleFieldIds, filter } = field.options;

    return {
      shareId: linkFieldId,
      tableId: field.options.foreignTableId,
      linkOptions: { filterByViewId, visibleFieldIds, filter },
      shareMeta: {
        allowCopy: true,
        includeRecords: true,
      },
    };
  }
}
