import { Controller, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ChatService } from './chat.service';

@Controller('api/chart')
export class ChatController {
  constructor(private readonly chartService: ChatService) {}

  @Post('completions')
  async completions(@Req() req: Request, @Res() res: Response) {
    await this.chartService.completions(req, res);
  }
}
