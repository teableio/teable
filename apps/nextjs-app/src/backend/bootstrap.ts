import { NestFactory } from '@nestjs/core';
import isPortReachable from 'is-port-reachable';
import { AppModule } from './app.module';

const host = 'localhost';

export async function bootstrap(port: number) {
  try {
    const app = await NestFactory.create(AppModule);
    console.log(`> Ready on http://${host}:${port}`);
    await app.listen(port);
  } catch (err) {
    console.error(`Failed to initialize, due to ${err}`);
    process.exit(1);
  }
}

export async function getAvailablePort(dPort: number): Promise<number> {
  let port = dPort;
  while (await isPortReachable(port, { host })) {
    console.log(`> Fail on http://${host}:${port} Trying on ${port + 1}`);
    port++;
  }
  return port;
}
