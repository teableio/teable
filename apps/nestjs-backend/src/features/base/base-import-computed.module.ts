import { Module } from '@nestjs/common';
import { V2Module } from '../v2/v2.module';
import { BaseImportComputedService } from './base-import-computed.service';

@Module({
  imports: [V2Module],
  providers: [BaseImportComputedService],
  exports: [BaseImportComputedService],
})
export class BaseImportComputedModule {}
