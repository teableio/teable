import { Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

@Controller('api/admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @UseGuards(AdminGuard)
  @Patch('/plugin/:pluginId/publish')
  async publishPlugin(@Param('pluginId') pluginId: string): Promise<void> {
    await this.adminService.publishPlugin(pluginId);
  }
}
