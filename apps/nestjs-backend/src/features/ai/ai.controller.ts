import { Body, Controller, Post, Res } from '@nestjs/common';
import { aiGenerateRoSchema, IAiGenerateRo } from '@teable/openapi';
import { Response } from 'express';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { TablePipe } from '../table/open-api/table.pipe';
import { AiService } from './ai.service';

@Controller('api/ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('/generate-stream')
  async generateStream(
    @Body(new ZodValidationPipe(aiGenerateRoSchema), TablePipe) aiGenerateRo: IAiGenerateRo,
    @Res() res: Response
  ) {
    const result = await this.aiService.generateStream(aiGenerateRo);
    result.pipeTextStreamToResponse(res);
  }
}
