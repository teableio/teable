import { Body, Controller, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { AiService } from './ai.service';
import { Task } from './type';

@Controller('api/ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}
  @Post()
  async generate(@Body('prompt') prompt: string, @Body('task') task: Task, @Res() res: Response) {
    const result = await this.aiService.generate(prompt, task);
    result.pipeTextStreamToResponse(res);
  }
}
