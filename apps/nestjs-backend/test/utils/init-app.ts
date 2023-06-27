import { ConsoleLogger, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import loadConfig from '../../src/configs/config';
import { TableOpenApiModule } from '../../src/features/table/open-api/table-open-api.module';

export async function initApp() {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        load: [loadConfig],
        isGlobal: true,
        expandVariables: true,
      }),
      TableOpenApiModule,
      EventEmitterModule.forRoot(),
    ],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useLogger(new ConsoleLogger());
  app.use(json({ limit: '50mb' }));
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, stopAtFirstError: true, forbidUnknownValues: false })
  );
  app.use(urlencoded({ limit: '50mb', extended: true }));
  await app.init();
  return app;
}
