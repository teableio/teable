import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';

@Injectable()
export class ViewPermissionService {
  constructor(private readonly cls: ClsService<IClsStore>) {}

  async getViewQueryWithPermission() {
    const shareViewId = this.cls.get('shareViewId');
    if (shareViewId) {
      return this.getViewQueryWithSharePermission();
    }
    return {};
  }

  private async getViewQueryWithSharePermission() {
    const shareViewId = this.cls.get('shareViewId');
    return { shareId: shareViewId, enableShare: true };
  }
}
