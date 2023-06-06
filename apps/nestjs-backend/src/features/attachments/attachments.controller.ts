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
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { responseWrap } from '../../../src/utils';
import { AttachmentsService } from './attachments.service';
import { AttachmentNotifyRo } from './modal/attachment-notify.ro';
import { AttachmentSignatureRo } from './modal/attachment-signature.ro';
import { AttachmentUploadVo } from './modal/attachment-upload.vo';

@ApiBearerAuth()
@ApiTags('attachments')
@Controller('api/attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post('/upload/:token')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'upload attachment',
    type: AttachmentUploadVo,
  })
  async uploadFile(@UploadedFile() file: Express.Multer.File, @Param('token') token: string) {
    await this.attachmentsService.upload(file, token);
    return responseWrap(null);
  }

  @Get(':token')
  @ApiQuery({
    name: 'filename',
    description: 'File name for download',
    required: false,
  })
  @ApiOperation({ summary: 'Get file stream' })
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
  @ApiOkResponse({
    description: 'I need to retrieve the upload URL and the key.',
    type: AttachmentSignatureRo,
  })
  async signature() {
    const res = await this.attachmentsService.signature();
    return responseWrap(res);
  }

  @Post('/notify/:secret')
  @ApiOkResponse({
    description: 'Attachment information',
    type: AttachmentNotifyRo,
  })
  async notify(@Param('secret') secret: string) {
    const attachment = await this.attachmentsService.notify(secret);
    return responseWrap(attachment);
  }
}
