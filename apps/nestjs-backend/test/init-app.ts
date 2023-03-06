import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import { TableOpenApiModule } from 'src/features/table/open-api/table-open-api.module';

export async function initApp() {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [TableOpenApiModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));
  await app.init();
  return app;
}
