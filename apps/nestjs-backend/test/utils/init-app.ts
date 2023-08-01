import { ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import { AppModule } from '../../src/app.module';
import { NextService } from '../../src/features/next/next.service';
import { WsGateway } from '../../src/ws/ws.gateway';
import { DevWsGateway } from '../../src/ws/ws.gateway.dev';

export async function initApp() {
  process.env.LOG_LEVEL = 'error';

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(NextService)
    .useValue({
      onModuleInit: () => {
        return;
      },
    })
    .overrideProvider(DevWsGateway)
    .useClass(WsGateway)
    .compile();

  const app = moduleFixture.createNestApplication();

  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, stopAtFirstError: true, forbidUnknownValues: false })
  );

  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));

  await app.listen(0);

  console.log(`> Jest Test NODE_ENV is ${process.env.NODE_ENV}`);
  console.log(`> Jest Test Ready on ${await app.getUrl()}`);
  return app;
}
