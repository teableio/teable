import { Injectable } from '@nestjs/common';
import { BaseDuplicateMode, type IDuplicateBaseRo } from '@teable/openapi';
import type { BaseImportProgressCallback } from './base-import.service';
import { BaseDuplicateService } from './base-duplicate.service';

type IDuplicateBaseV2Result = Awaited<ReturnType<BaseDuplicateService['duplicateBaseV2']>>;

@Injectable()
export class BaseDuplicateV2Service {
  constructor(private readonly baseDuplicateService: BaseDuplicateService) {}

  async duplicateBase(
    duplicateBaseRo: IDuplicateBaseRo,
    allowCrossBase: boolean = true,
    duplicateMode: BaseDuplicateMode = BaseDuplicateMode.Normal,
    onProgress?: BaseImportProgressCallback
  ): Promise<IDuplicateBaseV2Result> {
    return await this.baseDuplicateService.duplicateBaseV2(
      duplicateBaseRo,
      allowCrossBase,
      duplicateMode,
      onProgress
    );
  }
}
