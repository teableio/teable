import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import isPortReachable from 'is-port-reachable';
import { AppModule } from './app.module';
import { NotFoundExceptionFilter } from './filter/not-found.filter';

const host = 'localhost';

export async function bootstrap(port: number, dir?: string) {
  try {
    const app = await NestFactory.create(
      AppModule.forRoot({
        port,
        dir: dir,
      })
    );
    app.useGlobalFilters(new NotFoundExceptionFilter());
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

    console.log(`> Ready on http://${host}:${port}`);
    console.log(`> NODE_ENV is ${process.env.NODE_ENV}`);
    await app.listen(port);
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
