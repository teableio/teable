import { Injectable } from '@nestjs/common';
import { BaseDuplicateMode, type IDuplicateBaseRo } from '@teable/openapi';
import { BaseDuplicateService, type IDuplicateBaseV2Result } from './base-duplicate.service';
import type { BaseImportProgressCallback } from './base-import.service';

@Injectable()
export class BaseDuplicateV2Service {
  constructor(private readonly baseDuplicateService: BaseDuplicateService) {}

  async duplicateBase(
    duplicateBaseRo: IDuplicateBaseRo,
    allowCrossBase: boolean = true,
    duplicateMode: BaseDuplicateMode = BaseDuplicateMode.Normal,
    onProgress?: BaseImportProgressCallback,
    onHostRestored?: () => Promise<void>
  ): Promise<IDuplicateBaseV2Result> {
    return await this.baseDuplicateService.duplicateBaseV2(
      duplicateBaseRo,
      allowCrossBase,
      duplicateMode,
      onProgress,
      onHostRestored
    );
  }
}
