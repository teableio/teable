import type { OnModuleDestroy } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createV2NodePgContainer } from '@teable/v2-container-node';
import { v2PostgresDbTokens } from '@teable/v2-db-postgres';
import type { DependencyContainer } from '@teable/v2-di';

@Injectable()
export class V2ContainerService implements OnModuleDestroy {
  private containerPromise?: Promise<DependencyContainer>;

  constructor(private readonly configService: ConfigService) {}

  async getContainer(): Promise<DependencyContainer> {
    if (!this.containerPromise) {
      const connectionString = this.configService.getOrThrow<string>('PRISMA_DATABASE_URL');
      this.containerPromise = createV2NodePgContainer({ connectionString });
    }

    return this.containerPromise;
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.containerPromise) return;

    const container = await this.containerPromise;
    const db = container.resolve<{ destroy(): Promise<void> }>(v2PostgresDbTokens.db);
    await db.destroy();
  }
}
