import { NestFactory } from '@nestjs/core';
import isPortReachable from 'is-port-reachable';
import { AppModule } from './app.module';
import { NotFoundExceptionFilter } from './not-found.filter';

const host = 'localhost';

export async function bootstrap(port: number, dir?: string) {
  try {
    const app = await NestFactory.create(AppModule.forRoot({
      port,
      dir: dir,
    }));
    app.useGlobalFilters(new NotFoundExceptionFilter());
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
