import fs from 'fs';
import path from 'path';
import type { RedocOptions } from '@juicyllama/nestjs-redoc';
import { RedocModule } from '@juicyllama/nestjs-redoc';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { SwaggerModule } from '@nestjs/swagger';
import { openApiDocumentation } from '@teable-group/openapi';
import { json, urlencoded } from 'express';
import isPortReachable from 'is-port-reachable';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { ISecurityWebConfig, ISwaggerConfig } from './configs/bootstrap.config';
import { GlobalExceptionFilter } from './filter/global-exception.filter';
import 'dayjs/plugin/timezone';
import 'dayjs/plugin/utc';

const host = 'localhost';

export async function setUpAppMiddleware(app: INestApplication, configService: ConfigService) {
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, stopAtFirstError: true, forbidUnknownValues: false })
  );
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));

  const swagger = configService.get<ISwaggerConfig>('swagger')!;
  if (swagger.enabled) {
    const jsonString = JSON.stringify(openApiDocumentation);
    fs.writeFileSync(path.join(__dirname, '/openapi.json'), jsonString);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SwaggerModule.setup('/docs', app, openApiDocumentation as any);
  }

  const redocOptions: RedocOptions = {
    logo: {
      backgroundColor: '#F0F0F0',
      altText: 'Teable logo',
    },
  };
  // Instead of using SwaggerModule.setup() you call this module
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await RedocModule.setup('/redocs', app, openApiDocumentation as any, redocOptions);

  const securityWeb = configService.get<ISecurityWebConfig>('security.web')!;
  if (securityWeb.cors.enabled) {
    app.enableCors();
  }
}

export async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule, { snapshot: true });
    const configService = app.get(ConfigService);

    const logger = app.get(Logger);
    app.useLogger(logger);

    await setUpAppMiddleware(app, configService);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
    // app.getHttpServer().on('upgrade', async function (req: Request, socket: any, head: any) {
    //   if (req.url.startsWith('/_next')) {
    //     console.log('upgrade: ', req.url);
    //     const server = app.select(NextModule.DEFAULT).get(NextService).server;
    //     const result = await server.getUpgradeHandler()(req, socket, head);
    //     console.log('hmr result', result);
    //   }
    // });

    const port = await getAvailablePort(configService.get<string>('PORT') as string);
    process.env.PORT = port.toString();
    logger.log(`> Ready on http://${host}:${port}`);
    logger.log(`> NODE_ENV is ${process.env.NODE_ENV}`);
    await app.listen(port);
    return app;
  } catch (err) {
    console.error(`Failed to initialize, due to ${err}`);
    process.exit(1);
  }
}

async function getAvailablePort(dPort: number | string): Promise<number> {
  let port = Number(dPort);
  while (await isPortReachable(port, { host })) {
    console.log(`> Fail on http://${host}:${port} Trying on ${port + 1}`);
    port++;
  }
  return port;
}
