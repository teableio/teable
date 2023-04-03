import { Controller, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiForbiddenResponse, ApiBody } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { CompletionRo } from './chart-completion.ro';
import { ChatService } from './chat.service';

@Controller('api/chart')
export class ChatController {
  constructor(private readonly chartService: ChatService) {}

  @ApiOperation({ summary: 'Chat completions' })
  @ApiForbiddenResponse({ description: 'Forbidden.' })
  @ApiBody({
    type: CompletionRo,
  })
  @Post('completions')
  async completions(@Req() req: Request, @Res() res: Response) {
    await this.chartService.completions(req, res);
  }
}
