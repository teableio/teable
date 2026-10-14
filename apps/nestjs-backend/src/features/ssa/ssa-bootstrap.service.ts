import type { OnApplicationBootstrap } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { SYSTEM_USER_ID } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { SettingKey } from '@teable/openapi';
import { SsaConfig, ISsaConfig } from '../../configs/ssa.config';
import { SettingService } from '../setting/setting.service';

/**
 * Single-tenant hardening (fork-only).
 *
 * When `SSA_SINGLE_TENANT=true`, every boot idempotently enforces:
 * - `disallowSignUp = true`  → new accounts only via invitation
 * - `enableWaitlist  = false`
 *
 * Writes go through Prisma directly (the settings cache is invalidated by the
 * Setting model middleware) because `SettingService.updateSetting` expects a
 * request-scoped user for `createdBy`, which does not exist at boot.
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
    if (!this.ssaConfig.singleTenant) {
      return;
    }

    try {
      const current = await this.settingService.getSetting([
        SettingKey.DISALLOW_SIGN_UP,
        SettingKey.ENABLE_WAITLIST,
      ]);

      const enforce: { name: SettingKey; value: boolean; description: string }[] = [];

      if (current[SettingKey.DISALLOW_SIGN_UP] !== true) {
        enforce.push({
          name: SettingKey.DISALLOW_SIGN_UP,
          value: true,
          description: 'public sign-up disabled (invite-only)',
        });
      }

      if (current[SettingKey.ENABLE_WAITLIST] === true) {
        enforce.push({
          name: SettingKey.ENABLE_WAITLIST,
          value: false,
          description: 'waitlist disabled',
        });
      }

      if (!enforce.length) {
        this.logger.log('SSA single-tenant settings already enforced');
        return;
      }

      const prisma = this.prismaService.txClient();
      for (const { name, value, description } of enforce) {
        const content = JSON.stringify(value);
        await prisma.setting.upsert({
          where: { name },
          update: { content, lastModifiedBy: SYSTEM_USER_ID },
          create: { name, content, createdBy: SYSTEM_USER_ID },
        });
        this.logger.log(`SSA single-tenant: ${name} = ${value} (${description})`);
      }
    } catch (error) {
      // Never crash the API because hardening could not be applied (e.g. a
      // database that has not been migrated yet); surface it loudly instead.
      this.logger.error(
        'SSA single-tenant bootstrap failed — verify migrations ran and the database is reachable',
        error instanceof Error ? error.stack : String(error)
      );
    }
  }
}
