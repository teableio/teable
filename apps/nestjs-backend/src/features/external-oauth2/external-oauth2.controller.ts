/* eslint-disable @typescript-eslint/naming-convention */
import { Body, Controller, Get, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { Role } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { CollaboratorType, PrincipalType } from '@teable/openapi';
import { Request, Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { pickUserMe } from '../auth/utils';
import { UserService } from '../user/user.service';
import { ExternalOAuth2Service, type IExternalOAuth2TestData } from './external-oauth2.service';

@Controller('api/oauth2')
export class ExternalOAuth2Controller {
  private readonly logger = new Logger(ExternalOAuth2Controller.name);
  private readonly provider = 'external-oauth2';

  constructor(
    private readonly oauth2: ExternalOAuth2Service,
    private readonly userService: UserService,
    private readonly prismaService: PrismaService
  ) {}

  private async syncEmailFromExternalUserinfo(args: {
    userId: string;
    currentEmail: string;
    externalMail?: unknown;
  }) {
    const externalMail =
      typeof args.externalMail === 'string' && args.externalMail.trim()
        ? args.externalMail.trim().toLowerCase()
        : '';
    if (!externalMail || externalMail === args.currentEmail.toLowerCase()) {
      return args.currentEmail;
    }

    const occupied = await this.prismaService.txClient().user.findUnique({
      where: { email: externalMail, deletedTime: null },
      select: { id: true },
    });
    if (occupied && occupied.id !== args.userId) {
      return args.currentEmail;
    }

    await this.prismaService.txClient().user.update({
      where: { id: args.userId, deletedTime: null },
      data: { email: externalMail },
    });
    return externalMail;
  }

  private parseOrganizationConfig(rawConfig?: string | null): Record<string, unknown> | null {
    if (!rawConfig) return null;
    const s = rawConfig.trim();
    if (!s) return null;
    try {
      const parsed = JSON.parse(s) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  private mapExternalRoleToTeableRoleName(externalRole?: string): (typeof Role)[keyof typeof Role] {
    if (!externalRole) return Role.Viewer;
    const normalized = externalRole.trim().toLowerCase();
    switch (normalized) {
      case 'super_admin':
      case 'owner':
        return Role.Owner;
      case 'admin':
        return Role.Creator;
      case 'member':
        return Role.Editor;
      case 'readonly':
        return Role.Viewer;
      default:
        return Role.Viewer;
    }
  }

  private extractDesiredRoleBySpaceIdFromSpaceInfos(
    spaceInfos: IExternalOAuth2TestData['space_infos']
  ): Map<string, (typeof Role)[keyof typeof Role]> {
    const desired = new Map<string, (typeof Role)[keyof typeof Role]>();
    if (!spaceInfos?.length) return desired;

    for (const item of spaceInfos) {
      const spaceId = item.id.trim();
      const desiredRoleName = this.mapExternalRoleToTeableRoleName(item.role);
      desired.set(spaceId, desiredRoleName);
    }

    return desired;
  }

  private async getActiveSpaceIdSet(
    tx: ReturnType<PrismaService['txClient']>,
    externalSpaceIds: string[]
  ) {
    const activeSpaces = (await tx.space.findMany({
      where: {
        id: { in: externalSpaceIds },
        deletedTime: null,
      },
      select: { id: true },
    })) as Array<{ id: string }>;

    return {
      activeSpaceIdSet: new Set(activeSpaces.map((s: { id: string }) => s.id)),
      activeCount: activeSpaces.length,
    };
  }

  private async getExistingCollaboratorRoleMap(
    tx: ReturnType<PrismaService['txClient']>,
    userId: string
  ): Promise<{ existingSet: Set<string>; roleMap: Map<string, string>; existingCount: number }> {
    const existing = (await tx.collaborator.findMany({
      where: {
        resourceType: CollaboratorType.Space,
        principalType: PrincipalType.User,
        principalId: userId,
      },
      select: { resourceId: true, roleName: true },
    })) as Array<{ resourceId: string; roleName: string }>;

    const roleMap = new Map(existing.map((c) => [c.resourceId, c.roleName]));
    return {
      existingSet: new Set(existing.map((c) => c.resourceId)),
      roleMap,
      existingCount: existing.length,
    };
  }

  private async addCollaborators(
    tx: ReturnType<PrismaService['txClient']>,
    userId: string,
    toAdd: string[],
    desiredRoleBySpaceId: Map<string, (typeof Role)[keyof typeof Role]>
  ) {
    for (const spaceId of toAdd) {
      try {
        // Rely on unique constraint for idempotency; ignore duplicate insert under concurrency.
        await tx.collaborator.create({
          data: {
            resourceType: CollaboratorType.Space,
            resourceId: spaceId,
            principalType: PrincipalType.User,
            principalId: userId,
            roleName: desiredRoleBySpaceId.get(spaceId) ?? Role.Viewer,
            createdBy: userId,
          },
        });
      } catch (e) {
        if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
  }

  private async removeCollaborators(
    tx: ReturnType<PrismaService['txClient']>,
    userId: string,
    toRemove: string[]
  ) {
    await tx.collaborator.deleteMany({
      where: {
        resourceType: CollaboratorType.Space,
        principalType: PrincipalType.User,
        principalId: userId,
        resourceId: { in: toRemove },
      },
    });
  }

  private async updateCollaboratorRoles(
    tx: ReturnType<PrismaService['txClient']>,
    userId: string,
    activeSpaceIdSet: Set<string>,
    existingSet: Set<string>,
    roleMap: Map<string, string>,
    desiredRoleBySpaceId: Map<string, (typeof Role)[keyof typeof Role]>
  ) {
    const toUpdate = Array.from(activeSpaceIdSet).filter((id) => existingSet.has(id));
    for (const spaceId of toUpdate) {
      const currentRole = roleMap.get(spaceId);
      const desiredRoleName = desiredRoleBySpaceId.get(spaceId) ?? Role.Viewer;
      if (!currentRole || currentRole === desiredRoleName) continue;
      await tx.collaborator.update({
        where: {
          resourceType_resourceId_principalId_principalType: {
            resourceType: CollaboratorType.Space,
            resourceId: spaceId,
            principalId: userId,
            principalType: PrincipalType.User,
          },
        },
        data: { roleName: desiredRoleName },
      });
    }
  }

  private async syncUserSpaceCollaborators(
    userId: string,
    desiredRoleBySpaceId: Map<string, (typeof Role)[keyof typeof Role]>
  ) {
    if (desiredRoleBySpaceId.size === 0) {
      // 避免当 space_infos 异常缺失/为空时误删用户现有协作关系
      return;
    }
    const tx = this.prismaService.txClient();

    const externalSpaceIds = Array.from(desiredRoleBySpaceId.keys());
    const { activeSpaceIdSet, activeCount } = await this.getActiveSpaceIdSet(tx, externalSpaceIds);
    const { existingSet, roleMap, existingCount } = await this.getExistingCollaboratorRoleMap(
      tx,
      userId
    );

    const toAdd = Array.from(activeSpaceIdSet).filter((id) => !existingSet.has(id));
    const toRemove = Array.from(existingSet).filter((id) => !activeSpaceIdSet.has(id));

    if (toAdd.length) await this.addCollaborators(tx, userId, toAdd, desiredRoleBySpaceId);
    if (toRemove.length) await this.removeCollaborators(tx, userId, toRemove);
    await this.updateCollaboratorRoles(
      tx,
      userId,
      activeSpaceIdSet,
      existingSet,
      roleMap,
      desiredRoleBySpaceId
    );

    this.logger.log(
      `oauth2 sync spaces userId=${userId} external=${externalSpaceIds.length} active=${activeCount} existing=${existingCount} add=${toAdd.length} remove=${toRemove.length}`
    );
  }

  private pickEmailAndName(userinfo: { mail?: unknown; user_id: string; user_name?: unknown }) {
    const email =
      (typeof userinfo.mail === 'string' && userinfo.mail) ||
      `${userinfo.user_id}@external-oauth2.local`;
    const name = (typeof userinfo.user_name === 'string' && userinfo.user_name) || email;
    return { email, name };
  }

  /**
   * GET /api/oauth2/initiate?state=xxx&redirect_url=xxx
   * Returns { code, msg, data: { location, state, expires_in } }
   */
  @Public()
  @Get('initiate')
  async initiate(@Query('state') state: string, @Query('redirect_url') redirectUrl?: string) {
    const data = await this.oauth2.initiate(state, redirectUrl);
    return { code: 1000, msg: 'ok', data };
  }

  /**
   * GET /api/oauth2/callback?code=xxx&state=xxx&redirect_url=xxx
   * Exchanges code for token, validates token (test), finds/creates teable user, and logs in (session cookie).
   */
  @Public()
  @Get('callback')
  async callback(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('redirect_url') redirectUrl?: string
  ) {
    const token = await this.oauth2.exchangeCodeForToken(code, state, redirectUrl);
    const userinfo = await this.oauth2.test(token.access_token);

    const { email, name } = this.pickEmailAndName(userinfo);
    const providerId = String(userinfo.user_id);

    const user = await this.userService.findOrCreateUser({
      name,
      email,
      provider: this.provider,
      providerId,
      type: 'oauth2',
    });

    const u = user as unknown as {
      id: string;
      name: string;
      email: string;
      phone?: string | null;
      password?: string | null;
      notifyMeta?: string | null;
      isAdmin?: boolean | null;
      lang?: string | null;
      avatar?: string | null;
    };

    // 强制同步邮箱：以认证中心 mail 为准（前提：邮箱未被其他用户占用）
    u.email = await this.syncEmailFromExternalUserinfo({
      userId: u.id,
      currentEmail: u.email,
      externalMail: userinfo.mail,
    });

    const desiredRoleBySpaceId = this.extractDesiredRoleBySpaceIdFromSpaceInfos(
      userinfo.space_infos
    );
    await this.syncUserSpaceCollaborators(u.id, desiredRoleBySpaceId);

    const userMe = pickUserMe({
      id: u.id,
      name: u.name,
      phone: u.phone ?? undefined,
      email: u.email,
      password: u.password ?? undefined,
      notifyMeta: u.notifyMeta ?? undefined,
      isAdmin: u.isAdmin ?? undefined,
      lang: u.lang ?? undefined,
      avatar: u.avatar ?? undefined,
    });

    await new Promise<void>((resolve, reject) => {
      req.login(userMe, (err) => (err ? reject(err) : resolve()));
    });

    // Ensure NEXT_LOCALE cookie is set before redirecting to app pages
    const lang = (u.lang && typeof u.lang === 'string' ? u.lang : '') || 'zh';
    res.cookie('NEXT_LOCALE', lang, {
      maxAge: 31536000 * 1000,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    return { code: 1000, msg: 'ok', data: token };
  }

  /**
   * POST /api/oauth2/refresh
   * Body: { access_token: string } or Authorization: Bearer <access_token>
   */
  @Public()
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Body() body: { accessToken?: string; access_token?: string } = {}
  ) {
    const header = req.headers.authorization;
    const accessToken =
      (header && header.startsWith('Bearer ') ? header.substring(7) : undefined) ||
      body.accessToken ||
      body.access_token;
    if (!accessToken) {
      return { code: 400, msg: 'missing access_token', data: null };
    }
    const token = await this.oauth2.refresh(accessToken);
    return { code: 1000, msg: 'ok', data: token };
  }

  /**
   * GET /api/oauth2/try (Authorization: Bearer <access_token>)
   */
  @Public()
  @Get('try')
  async try(@Req() req: Request) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return { code: 401, msg: 'invalid access token', data: null };
    }
    const accessToken = header.substring(7);
    const userinfo = await this.oauth2.test(accessToken);

    const providerId = String(userinfo.user_id);

    // 尽量不在 /try 阶段创建新 teable 用户，只在用户已存在时同步协作空间。
    const account = await this.prismaService.txClient().account.findFirst({
      where: { provider: this.provider, providerId },
      select: { userId: true },
    });
    if (account?.userId) {
      const desiredRoleBySpaceId = this.extractDesiredRoleBySpaceIdFromSpaceInfos(
        userinfo.space_infos
      );
      await this.syncUserSpaceCollaborators(account.userId, desiredRoleBySpaceId);
    }

    return { code: 1000, msg: 'ok' };
  }

  /**
   * GET /api/oauth2/userinfo (Authorization: Bearer <access_token>)
   */
  @Public()
  @Get('userinfo')
  async userinfo(@Req() req: Request) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return { code: 401, msg: 'unauthorized', data: null };
    }
    const accessToken = header.substring(7);
    const data = await this.oauth2.test(accessToken);

    const account = await this.prismaService.txClient().account.findFirst({
      where: { provider: this.provider, providerId: String(data.user_id) },
      select: { userId: true },
    });
    if (account?.userId) {
      const desiredRoleBySpaceId = this.extractDesiredRoleBySpaceIdFromSpaceInfos(data.space_infos);
      await this.syncUserSpaceCollaborators(account.userId, desiredRoleBySpaceId);
    }

    return { code: 2000, msg: 'ok', data };
  }
}
