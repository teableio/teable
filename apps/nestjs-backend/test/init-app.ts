import { ConsoleLogger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import { createMockConfigService } from '../src/configs/config.spec';
import { TableOpenApiModule } from '../src/features/table/open-api/table-open-api.module';

export async function initApp() {
  const mockConfigService = createMockConfigService({ PORT: 3001 });
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [TableOpenApiModule, EventEmitterModule.forRoot()],
    providers: [
      {
        provide: ConfigService,
        useValue: mockConfigService,
      },
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
