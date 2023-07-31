import { ConsoleLogger, ValidationPipe } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import { AppModule } from 'src/app.module';
import { NextService } from 'src/features/next/next.service';

export async function initApp() {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(NextService)
    .useValue({
      onModuleInit: () => {
        return;
      },
    })
    .compile();

  const app = moduleFixture.createNestApplication();
  app.useLogger(new ConsoleLogger());
  app.use(json({ limit: '50mb' }));
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, stopAtFirstError: true, forbidUnknownValues: false })
  );
  app.use(urlencoded({ limit: '50mb', extended: true }));
  await app.listen(0);

  console.log(`> Jest Test NODE_ENV is ${process.env.NODE_ENV}`);
  console.log(`> Jest Test Ready on ${await app.getUrl()}`);
  return app;
}
