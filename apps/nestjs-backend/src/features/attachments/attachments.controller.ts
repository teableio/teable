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
import { responseWrap } from '../../utils';
import { AttachmentsService } from './attachments.service';

@Controller('api/attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post('/upload/:token')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File, @Param('token') token: string) {
    await this.attachmentsService.upload(file, token);
    return responseWrap(null);
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
    const res = await this.attachmentsService.signature();
    return responseWrap(res);
  }

  @Post('/notify/:secret')
  async notify(@Param('secret') secret: string) {
    const attachment = await this.attachmentsService.notify(secret);
    return responseWrap(attachment);
  }
}
