import { Controller, Get, Param, Patch, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { AdminService } from './admin.service';

@Controller('api/admin')
@Permissions('instance|update')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Patch('/plugin/:pluginId/publish')
  async publishPlugin(@Param('pluginId') pluginId: string): Promise<void> {
    await this.adminService.publishPlugin(pluginId);
  }

  @Post('/attachment/repair-table-thumbnail')
  async repairTableAttachmentThumbnail(): Promise<void> {
    await this.adminService.repairTableAttachmentThumbnail();
  }

  @Get('/debug/heap-snapshot')
  async getHeapSnapshot(@Res() res: Response): Promise<void> {
    await this.adminService.getHeapSnapshot(res);
  }
}
