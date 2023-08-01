import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@teable-group/db-main-prisma';

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const logConfig = {
      log: [
        {
          emit: 'event',
          level: 'query',
        },
        {
          emit: 'stdout',
          level: 'error',
        },
        {
          emit: 'stdout',
          level: 'info',
        },
        {
          emit: 'stdout',
          level: 'warn',
        },
      ],
    };
    const initialConfig = process.env.NODE_ENV === 'production' ? {} : { ...logConfig };

    super(initialConfig);
  }

  async onModuleInit() {
    await this.$connect();

    if (process.env.NODE_ENV === 'production') return;

    this.$on('query', async (e) => {
      this.logger.debug({
        Query: e.query.trim().replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')'),
        Params: e.params,
        Duration: `${e.duration} ms`,
      });
    });
  }
}
