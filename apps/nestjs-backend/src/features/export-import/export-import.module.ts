import { Module } from '@nestjs/common';
import { PrismaService } from '../..//prisma.service';
import { ExportImportController } from './export-import.controller';
import { ExportImportService } from './export-import.service';

@Module({
  controllers: [ExportImportController],
  providers: [PrismaService, ExportImportService],
})
export class ExportImportModule {}
