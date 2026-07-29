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

  // The disposition query param is caller input — a malformed percent
  // sequence (e.g. a bare '%') is expected; fall back to the raw value so it
  // gets percent-encoded as-is.
  private safeDecodeURIComponent(value: string) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  @Get('/read/:path(*)')
  async read(
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
    @Param('path') path: string,
    @Query('token') token: string,
    @Query('response-content-disposition') responseContentDisposition?: string
  ) {
    const headers: Record<string, string> = {};
    headers['Cross-Origin-Resource-Policy'] = 'unsafe-none';
    headers['Content-Security-Policy'] = '';

    const hasCache = this.attachmentsService.localFileConditionalCaching(path, req.headers, res);
    if (hasCache) {
      res.set(headers);
      res.status(304);
      return;
    }
    const { fileStream, headers: fileHeaders } = await this.attachmentsService.readLocalFile(
      path,
      token
    );
    Object.assign(headers, fileHeaders);
    if (responseContentDisposition) {
      // RFC 5987: the filename*= value is already percent-encoded — decode it
      // before re-encoding, otherwise the file name gets double-encoded. The
      // plain filename= value is raw and only needs encoding.
      const utf8Match = responseContentDisposition.match(/filename\*=UTF-8''([^;]+)/);
      const fileName = utf8Match
        ? this.safeDecodeURIComponent(utf8Match[1])
        : responseContentDisposition.match(/filename="?([^"]+)"?/)?.[1];
      headers['Content-Disposition'] = fileName
        ? `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
        : responseContentDisposition;
    }
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
