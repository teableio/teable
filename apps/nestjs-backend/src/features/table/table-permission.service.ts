import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';

@Injectable()
export class TablePermissionService {
  constructor(private readonly cls: ClsService<IClsStore>) {}

  async getProjectionTableIds(_baseId: string): Promise<string[] | undefined> {
    const shareViewId = this.cls.get('shareViewId');
    if (shareViewId) {
      return this.getViewQueryWithSharePermission();
    }
  }

  protected async getViewQueryWithSharePermission() {
    return [];
  }
}
