// fixme: disable eslint for nest src
import { Controller, Get } from '@nestjs/common';
import type { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('/api/1')
  getHello(): string {
    return this.appService.getHello();
  }
}
