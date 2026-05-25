import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { cliOAuthApp } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { DistributedLockService } from '../../distributed-lock';

/**
 * Seeds the first-party CLI OAuth app on startup so `@teable/cli`'s
 * Authorization Code + PKCE login works against any Teable deployment without
 * manually registering an OAuth app.
 *
 * Idempotent: upserts the `oauth_app` row to match `cliOAuthApp`. A distributed
 * lock keeps only one instance seeding in a multi-pod deployment.
 */
@Injectable()
export class OAuthAppInitService implements OnModuleInit {
  private readonly logger = new Logger(OAuthAppInitService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly distributedLock: DistributedLockService
  ) {}

  async onModuleInit() {
    // 60s lock — ample for a single upsert; auto-expires if this instance dies.
    await this.distributedLock.runExclusive('oauth-app-init', 60, () => this.seedCliOAuthApp());
  }

  /** Seed/reconcile the first-party CLI OAuth app row. Idempotent. */
  private async seedCliOAuthApp() {
    const { clientId, name, homepage, description, logo, redirectUris, scopes } = cliOAuthApp;
    const data = {
      name,
      homepage,
      description,
      logo,
      redirectUris: JSON.stringify(redirectUris),
      scopes: JSON.stringify(scopes),
    };

    try {
      await this.prismaService.oAuthApp.upsert({
        where: { clientId },
        // `createdBy: 'system'` — system-seeded row, no owning user.
        create: { clientId, createdBy: 'system', ...data },
        update: data,
      });
      this.logger.log(`Initialized CLI OAuth app: ${clientId}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      // Without Redis the lock is a no-op, so a concurrent upsert from another
      // instance can still race on the unique clientId — ignore that conflict.
      if (error.code !== 'P2002') {
        throw error;
      }
    }
  }
}
