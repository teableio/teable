import {
  Controller,
  Get,
  Post,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  Body,
} from '@nestjs/common';
import { dbPath } from '@teable-group/db-main-prisma';
import { Response } from 'express';
import { ExportImportService } from './export-import.service';

const filePath = dbPath.split('?')[0];

@Controller('api/export-import')
export class ExportImportController {
  private logger = new Logger(ExportImportController.name);
  constructor(private readonly exportImportService: ExportImportService) {}

  @Get('download')
  async downloadFile(@Res() res: Response): Promise<void> {
    this.logger.log('filePath:' + filePath);
    const zipStream = await this.exportImportService.createZipStream(filePath);

    res.setHeader('Content-Disposition', 'attachment; filename=data.teable');
    res.setHeader('Content-Type', 'application/zip');
    zipStream.pipe(res);
  }

  @Post('import')
  @HttpCode(HttpStatus.NO_CONTENT)
  async importFile(@Body('url') url: string): Promise<void> {
    this.logger.log('import url:' + url);
    const regex = /^(.*\/)/;
    const match = filePath.match(regex);
    const outputDir = match?.[1];
    if (!url) {
      throw new BadRequestException('URL is required');
    }
    this.logger.log('outputDir:' + outputDir);
    if (!outputDir) {
      throw new BadRequestException('outputDir is required');
    }
    await this.exportImportService.downloadAndUnzip(url, outputDir);
  }
}
