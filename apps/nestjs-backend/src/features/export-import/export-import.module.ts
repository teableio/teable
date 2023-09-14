import { Module } from '@nestjs/common';
import { ExportImportController } from './export-import.controller';
import { ExportImportService } from './export-import.service';

@Module({
  controllers: [ExportImportController],
  providers: [ExportImportService],
})
export class ExportImportModule {}
