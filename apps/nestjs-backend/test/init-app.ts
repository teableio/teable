import { ConsoleLogger } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import { AutomationModule } from 'src/features/automation/automation.module';
import { NextModule } from 'src/features/next/next.module';
import { TableOpenApiModule } from 'src/features/table/open-api/table-open-api.module';

export async function initApp() {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [TableOpenApiModule, NextModule, EventEmitterModule.forRoot(), AutomationModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useLogger(new ConsoleLogger());
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));
  await app.init();
  return app;
}
