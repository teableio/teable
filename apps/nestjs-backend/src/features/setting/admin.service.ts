import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { PluginStatus } from '@teable/openapi';

@Injectable()
export class AdminService {
  constructor(private readonly prismaService: PrismaService) {}

  async publishPlugin(pluginId: string) {
    return this.prismaService.plugin.update({
      where: { id: pluginId, status: PluginStatus.Reviewing },
      data: { status: PluginStatus.Published },
    });
  }
}
