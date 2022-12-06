import type { INestApplication, OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { PrismaClientDbMain } from '@teable-group/db-main-prisma';

@Injectable()
export class PrismaService extends PrismaClientDbMain implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }

  async enableShutdownHooks(app: INestApplication) {
    this.$on('beforeExit', async () => {
      await app.close();
    });
  }
}
