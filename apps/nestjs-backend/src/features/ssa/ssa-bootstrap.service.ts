import type { OnApplicationBootstrap } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { SYSTEM_USER_ID } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { SettingKey } from '@teable/openapi';
import { SsaConfig, ISsaConfig } from '../../configs/ssa.config';
import { SettingService } from '../setting/setting.service';

interface IEnforcedSetting {
  name: SettingKey;
  value: unknown;
  description: string;
}

/**
 * Env-driven instance settings (fork-only).
 *
 * - `SSA_SINGLE_TENANT=true` → invite-only registration (`disallowSignUp`),
 *   waitlist off.
 * - `SSA_BRAND_NAME` / `SSA_BRAND_LOGO` → operator brand mirrored into the
 *   instance settings (the client receives them through the env seam in
 *   `withEnv`; see docs/ssa/BRANDING.md). Teable brand assets stay untouched.
 *
 * Idempotent on every boot; writes go through Prisma directly (the settings
 * cache is invalidated by the Setting model middleware) because
 * `SettingService.updateSetting` expects a request-scoped user for `createdBy`,
 * which does not exist at boot.
 */
@Injectable()
export class SsaBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SsaBootstrapService.name);

  constructor(
    @SsaConfig() private readonly ssaConfig: ISsaConfig,
    private readonly settingService: SettingService,
    private readonly prismaService: PrismaService
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const enforced = await this.collectEnforcedSettings();
      if (!enforced.length) {
        this.logger.log('SSA settings already enforced');
        return;
      }

      const prisma = this.prismaService.txClient();
      for (const { name, value, description } of enforced) {
        const content = JSON.stringify(value);
        await prisma.setting.upsert({
          where: { name },
          update: { content, lastModifiedBy: SYSTEM_USER_ID },
          create: { name, content, createdBy: SYSTEM_USER_ID },
        });
        this.logger.log(`SSA: ${name} = ${content} (${description})`);
      }
    } catch (error) {
      // Never crash the API because settings could not be applied (e.g. a
      // database that has not been migrated yet); surface it loudly instead.
      this.logger.error(
        'SSA bootstrap failed — verify migrations ran and the database is reachable',
        error instanceof Error ? error.stack : String(error)
      );
    }
  }

  private async collectEnforcedSettings(): Promise<IEnforcedSetting[]> {
    const enforced: IEnforcedSetting[] = [];

    if (this.ssaConfig.singleTenant) {
      const current = await this.settingService.getSetting([
        SettingKey.DISALLOW_SIGN_UP,
        SettingKey.ENABLE_WAITLIST,
      ]);

      if (current[SettingKey.DISALLOW_SIGN_UP] !== true) {
        enforced.push({
          name: SettingKey.DISALLOW_SIGN_UP,
          value: true,
          description: 'public sign-up disabled (invite-only)',
        });
      }

      if (current[SettingKey.ENABLE_WAITLIST] === true) {
        enforced.push({
          name: SettingKey.ENABLE_WAITLIST,
          value: false,
          description: 'waitlist disabled',
        });
      }
    }

    const brandName = (this.ssaConfig.brand?.name ?? '').trim();
    if (brandName) {
      const current = await this.settingService.getSetting([SettingKey.BRAND_NAME]);
      if (current[SettingKey.BRAND_NAME] !== brandName) {
        enforced.push({
          name: SettingKey.BRAND_NAME,
          value: brandName,
          description: 'operator brand name',
        });
      }
    }

    const brandLogo = (this.ssaConfig.brand?.logo ?? '').trim();
    if (brandLogo) {
      const current = await this.settingService.getSetting([SettingKey.BRAND_LOGO]);
      if (current[SettingKey.BRAND_LOGO] !== brandLogo) {
        enforced.push({
          name: SettingKey.BRAND_LOGO,
          value: brandLogo,
          description: 'operator brand logo',
        });
      }
    }

    return enforced;
  }
}
