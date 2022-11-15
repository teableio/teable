import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { Express } from 'express';
import { AppModule } from './app.module';

export async function bootstrap(server: Express) {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));
  await app.init();
}
