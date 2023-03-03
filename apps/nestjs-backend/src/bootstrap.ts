import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import isPortReachable from 'is-port-reachable';
import { AppModule } from './app.module';
import { NotFoundExceptionFilter } from './filter/not-found.filter';

const host = 'localhost';

export function setUpAppMiddleware(app: INestApplication) {
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalFilters(new NotFoundExceptionFilter());
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));
  // app.setGlobalPrefix('api');

  const options = new DocumentBuilder()
    .setTitle('Teable App')
    .setDescription('Manage Data as easy as drink a cup of tea')
    // .setVersion('1.0')
    // .setBasePath('api')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('/docs', app, document);
}

export async function bootstrap(port: number, dir?: string) {
  try {
    const app = await NestFactory.create(
      AppModule.forRoot({
        port,
        dir: dir,
      }),
      {
        snapshot: true,
      }
    );

    setUpAppMiddleware(app);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
    // app.getHttpServer().on('upgrade', async function (req: Request, socket: any, head: any) {
    //   if (req.url.startsWith('/_next')) {
    //     console.log('upgrade: ', req.url);
    //     const server = app.select(NextModule.DEFAULT).get(NextService).server;
    //     const result = await server.getUpgradeHandler()(req, socket, head);
    //     console.log('hmr result', result);
    //   }
    // });

    console.log(`> Ready on http://${host}:${port}`);
    console.log(`> NODE_ENV is ${process.env.NODE_ENV}`);
    await app.listen(port);
    return app;
  } catch (err) {
    console.error(`Failed to initialize, due to ${err}`);
    process.exit(1);
  }
}

export async function getAvailablePort(dPort: number | string): Promise<number> {
  let port = Number(dPort);
  while (await isPortReachable(port, { host })) {
    console.log(`> Fail on http://${host}:${port} Trying on ${port + 1}`);
    port++;
  }
  return port;
}
