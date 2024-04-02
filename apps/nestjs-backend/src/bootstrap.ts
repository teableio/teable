import 'dayjs/plugin/timezone';
import 'dayjs/plugin/utc';
import fs from 'fs';
import path from 'path';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import type { OpenAPIObject } from '@nestjs/swagger';
import { SwaggerModule } from '@nestjs/swagger';
import { getOpenApiDocumentation } from '@teable/openapi';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import isPortReachable from 'is-port-reachable';
import { Logger } from 'nestjs-pino';
import type { RedocOptions } from 'nestjs-redoc';
import { RedocModule } from 'nestjs-redoc';
import { AppModule } from './app.module';
import type { IBaseConfig } from './configs/base.config';
import type { ISecurityWebConfig, IApiDocConfig } from './configs/bootstrap.config';
import { GlobalExceptionFilter } from './filter/global-exception.filter';
import otelSDK from './tracing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const module: any;

const host = 'localhost';

export async function setUpAppMiddleware(app: INestApplication, configService: ConfigService) {
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalFilters(new GlobalExceptionFilter(configService));
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, stopAtFirstError: true, forbidUnknownValues: false })
  );
  app.use(helmet());
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));

  const apiDocConfig = configService.get<IApiDocConfig>('apiDoc');
  const securityWebConfig = configService.get<ISecurityWebConfig>('security.web');
  const baseConfig = configService.get<IBaseConfig>('base');
  if (!apiDocConfig?.disabled) {
    const openApiDocumentation = await getOpenApiDocumentation({
      origin: baseConfig?.publicOrigin,
      snippet: apiDocConfig?.enabledSnippet,
    });

    const jsonString = JSON.stringify(openApiDocumentation);
    fs.writeFileSync(path.join(__dirname, '/openapi.json'), jsonString);
    SwaggerModule.setup('/docs', app, openApiDocumentation as OpenAPIObject);

    // Instead of using SwaggerModule.setup() you call this module
    const redocOptions: RedocOptions = {
      logo: {
        backgroundColor: '#F0F0F0',
        altText: 'Teable logo',
      },
    };
    await RedocModule.setup('/redocs', app, openApiDocumentation as OpenAPIObject, redocOptions);
  }

  if (securityWebConfig?.cors.enabled) {
    app.enableCors();
  }
}

export async function bootstrap() {
  otelSDK.start();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService = app.get(ConfigService);

  if (module.hot) {
    module.hot.accept();
    module.hot.dispose(() => app.close());
  }

  const logger = app.get(Logger);
  app.useLogger(logger);
  app.flushLogs();

  app.enableShutdownHooks();

  await setUpAppMiddleware(app, configService);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  // app.getHttpServer().on('upgrade', async function (req: any, socket: any, head: any) {
  //   if (req.url.startsWith('/_next')) {
  //     console.log('upgrade: ', req.url);
  //     const server = app.get(NextService).server;
  //     return server.getUpgradeHandler()(req, socket, head);
  //   }
  // });

  const port = await getAvailablePort(configService.get<string>('PORT') as string);
  process.env.PORT = port.toString();

  await app.listen(port);

  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  logger.log(`> NODE_ENV is ${process.env.NODE_ENV}`);
  logger.log(`> Ready on http://${host}:${port}`);
  logger.log(`> System Time Zone: ${timeZone}`);
  logger.log(`> Current System Time: ${now.toString()}`);

  process.on('unhandledRejection', (reason: string, promise: Promise<unknown>) => {
    logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
    throw reason;
  });

  process.on('uncaughtException', (error) => {
    logger.error(error);
  });
  return app;
}

async function getAvailablePort(dPort: number | string): Promise<number> {
  let port = Number(dPort);
  while (await isPortReachable(port, { host })) {
    console.log(`> Fail on http://${host}:${port} Trying on ${port + 1}`);
    port++;
  }
  return port;
}
