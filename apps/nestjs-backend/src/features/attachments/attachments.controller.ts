/* eslint-disable @typescript-eslint/naming-convention */
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { SignatureRo, signatureRoSchema } from '@teable/openapi';
import type { INotifyVo, SignatureVo } from '@teable/openapi';
import { Response, Request } from 'express';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { AuthGuard } from '../auth/guard/auth.guard';
import { AttachmentsService } from './attachments.service';
import { DynamicAuthGuardFactory } from './guard/auth.guard';

@Controller('api/attachments')
@Public()
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Put('/upload/:token')
  async uploadFilePut(@Req() req: Request, @Param('token') token: string) {
    await this.attachmentsService.upload(req, token);
    return null;
  }

  @Post('/upload/:token')
  async uploadFilePost(@Req() req: Request, @Param('token') token: string) {
    await this.attachmentsService.upload(req, token);
    return null;
  }

  @Get('/read/:path(*)')
  async read(
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
    @Param('path') path: string,
    @Query('token') token: string,
    @Query('response-content-disposition') responseContentDisposition?: string
  ) {
    const hasCache = this.attachmentsService.localFileConditionalCaching(path, req.headers, res);
    if (hasCache) {
      res.status(304);
      return;
    }
    const { fileStream, headers } = await this.attachmentsService.readLocalFile(path, token);
    if (responseContentDisposition) {
      const fileNameMatch =
        responseContentDisposition.match(/filename\*=UTF-8''([^;]+)/) ||
        responseContentDisposition.match(/filename="?([^"]+)"?/);
      if (fileNameMatch) {
        const fileName = fileNameMatch[1] as string;
        headers['Content-Disposition'] =
          `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
      } else {
        headers['Content-Disposition'] = responseContentDisposition;
      }
    }
    headers['Cross-Origin-Resource-Policy'] = 'unsafe-none';
    headers['Content-Security-Policy'] = '';
    res.set(headers);
    return new StreamableFile(fileStream);
  }

  @UseGuards(AuthGuard, DynamicAuthGuardFactory)
  @Post('/signature')
  async signature(
    @Body(new ZodValidationPipe(signatureRoSchema)) body: SignatureRo
  ): Promise<SignatureVo> {
    return await this.attachmentsService.signature(body);
  }

  @UseGuards(AuthGuard, DynamicAuthGuardFactory)
  @Post('/notify/:token')
  async notify(
    @Param('token') token: string,
    @Query('filename') filename?: string
  ): Promise<INotifyVo> {
    return await this.attachmentsService.notify(token, filename);
  }
}
