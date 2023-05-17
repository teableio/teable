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
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { responseWrap } from '../../../src/utils';
import { AttachmentsService } from './attachments.service';
import { AttachmentUploadRo } from './modal/attachment-upload.ro';
import { AttachmentUploadVo } from './modal/attachment-upload.vo';

@ApiBearerAuth()
@ApiTags('attachments')
@Controller('api/attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post('/upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'upload attachment',
    type: AttachmentUploadVo,
  })
  @ApiOkResponse({
    description: 'attachment',
    type: AttachmentUploadRo,
  })
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    const res = await this.attachmentsService.upload(file);
    return responseWrap(res);
  }

  @Get(':token')
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

  @Post('/getUploadUrl')
  async getUploadUrl() {
    return this.attachmentsService.getUploadUrl();
  }
}
