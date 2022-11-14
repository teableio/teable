import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

export async function bootstrap(port: number) {
  const app = await NestFactory.create(AppModule);
  await app.listen(port);
}
