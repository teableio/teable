/* eslint-disable @typescript-eslint/naming-convention */
import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { INotifyVo } from '@teable-group/openapi';
import { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { AttachmentsService } from './attachments.service';

@Controller('api/attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post('/upload/:token')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File, @Param('token') token: string) {
    await this.attachmentsService.upload(file, token);
    return null;
  }

  @Public()
  @Get(':token')
  async read(
    @Res({ passthrough: true }) res: Response,
    @Param('token') token: string,
    @Query('filename') filename?: string
  ) {
    const { fileStream, headers } = await this.attachmentsService.readLocalFile(token, filename);
    res.set(headers);
    // one years
    const maxAge = 60 * 60 * 24 * 365;
    res.set({
      ...headers,
      'Cache-Control': `public, max-age=${maxAge}`,
    });

    return new StreamableFile(fileStream);
  }

  @Post('/signature')
  async signature() {
    return await this.attachmentsService.signature();
  }

  @Post('/notify/:secret')
  async notify(@Param('secret') secret: string): Promise<INotifyVo> {
    return await this.attachmentsService.notify(secret);
  }
}
