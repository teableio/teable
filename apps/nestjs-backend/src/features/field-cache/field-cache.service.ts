import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';

/** Request-local field metadata cache shared by native and legacy field mutations. */
@Injectable()
export class FieldCacheService {
  constructor(private readonly cls: ClsService<IClsStore>) {}

  invalidateTables(tableIds: string | readonly string[]): void {
    if (!this.cls.isActive() || !this.cls.get('dataLoaderCache.cacheKeys')?.includes('field')) {
      return;
    }

    const ids = (typeof tableIds === 'string' ? [tableIds] : tableIds).filter(Boolean);
    if (!ids.length) {
      return;
    }

    const loaderData = this.cls.get('dataLoaderCache.fieldData');
    if (!loaderData) {
      return;
    }

    const { dataMap, fullParentIds } = loaderData;
    if (fullParentIds?.length) {
      loaderData.fullParentIds = fullParentIds.filter((parentId) => !ids.includes(parentId));
    }

    if (dataMap?.size) {
      const tableIdSet = new Set(ids);
      for (const [fieldId, field] of dataMap.entries()) {
        if (field?.tableId && tableIdSet.has(field.tableId)) {
          dataMap.delete(fieldId);
        }
      }
    }

    this.cls.set('dataLoaderCache.fieldData', loaderData);
  }
}
