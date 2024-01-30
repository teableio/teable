/* eslint-disable @typescript-eslint/naming-convention */
import type { Provider } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { Knex } from 'knex';
import { InitBootstrapService } from './init-bootstrap.service';

export const InitBootstrapProvider: Provider = {
  provide: InitBootstrapService,
  useFactory: async (prismaService: PrismaService, knex: Knex) => {
    const initBootstrapService = new InitBootstrapService(prismaService, knex);

    await initBootstrapService.init();

    return initBootstrapService;
  },
  inject: [PrismaService, 'CUSTOM_KNEX'],
};
