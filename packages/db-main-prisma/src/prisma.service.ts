import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import type { ClsService } from 'nestjs-cls';

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly cls: ClsService) {
    const logConfig = {
      log: [
        {
          level: 'query',
          emit: 'event',
        },
        {
          level: 'error',
          emit: 'stdout',
        },
        {
          level: 'info',
          emit: 'stdout',
        },
        {
          level: 'warn',
          emit: 'stdout',
        },
      ],
    };
    const initialConfig = process.env.NODE_ENV === 'production' ? {} : { ...logConfig };
    super(initialConfig);
  }

  async onModuleInit() {
    await this.$connect();

    // await this.$queryRaw`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;`.catch((error) => {
    //   this.logger.error('Prisma Set `PRAGMA` Failed due to:', error.stack);
    //   process.exit(1);
    // });

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
