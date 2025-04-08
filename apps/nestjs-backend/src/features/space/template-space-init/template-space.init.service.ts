import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { IdPrefix } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';

@Injectable()
export class TemplateSpaceInitService implements OnModuleInit {
  private logger = new Logger(TemplateSpaceInitService.name);

  constructor(private readonly prismaService: PrismaService) {}

  async onModuleInit() {
    const prisma = this.prismaService.txClient();

    const templateSpace = await prisma.space.findFirst({
      where: {
        isTemplate: true,
      },
    });

    if (templateSpace) {
      this.logger.log('Template space already exists');
      return;
    }

    const initTemplateSpaceId = `${IdPrefix.Space}DefaultTempSpcId`;

    await prisma.space.create({
      data: {
        id: initTemplateSpaceId,
        name: 'Template Space',
        isTemplate: true,
        createdBy: 'system',
      },
    });

    this.logger.log('Template space created');
  }
}
