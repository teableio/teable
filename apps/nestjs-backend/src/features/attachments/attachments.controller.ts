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
import { Response } from 'express';
import { AttachmentsService } from './attachments.service';

@Controller('api/attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post('/upload/:token')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File, @Param('token') token: string) {
    this.attachmentsService.upload(file, token);
    return null;
  }

  @Get(':token')
  async read(
    @Res({ passthrough: true }) res: Response,
    @Param('token') token: string,
    @Query('filename') filename?: string
  ) {
    const { fileStream, headers } = await this.attachmentsService.readLocalFile(token, filename);
    res.set(headers);
    return new StreamableFile(fileStream);
  }

  @Post('/signature')
  async signature() {
    return await this.attachmentsService.signature();
  }

  @Post('/notify/:secret')
  async notify(@Param('secret') secret: string) {
    return await this.attachmentsService.notify(secret);
  }
}
