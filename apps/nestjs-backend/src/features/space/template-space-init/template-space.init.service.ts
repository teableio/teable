import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { IdPrefix } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';

export const TEMPLATE_SPACE_ID = `${IdPrefix.Space}DefaultTempSpcId`;

@Injectable()
export class TemplateSpaceInitService implements OnModuleInit {
  private logger = new Logger(TemplateSpaceInitService.name);

  constructor(private readonly prismaService: PrismaService) {}

  async onModuleInit() {
    const prisma = this.prismaService.txClient();

    const initTemplateSpaceId = TEMPLATE_SPACE_ID;

    await prisma.space.upsert({
      where: {
        id: initTemplateSpaceId,
      },
      update: {
        isTemplate: true,
      },
      create: {
        id: initTemplateSpaceId,
        name: 'Template Space',
        isTemplate: true,
        createdBy: 'system',
      },
    });

    this.logger.log('Template space ensured');
  }
}
