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
import { SignatureRo, signatureRoSchema } from '@teable-group/openapi';
import type { INotifyVo, SignatureVo } from '@teable-group/openapi';
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

  @Get('/read')
  async read(
    @Res({ passthrough: true }) res: Response,
    @Query('token') token: string,
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

  @UseGuards(AuthGuard, DynamicAuthGuardFactory)
  @Post('/signature')
  async signature(
    @Body(new ZodValidationPipe(signatureRoSchema)) body: SignatureRo
  ): Promise<SignatureVo> {
    return await this.attachmentsService.signature(body);
  }

  @UseGuards(AuthGuard, DynamicAuthGuardFactory)
  @Post('/notify/:token')
  async notify(@Param('token') token: string): Promise<INotifyVo> {
    return await this.attachmentsService.notify(token);
  }
}
