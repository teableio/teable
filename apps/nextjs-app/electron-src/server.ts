import { createServer } from 'http';
import { parse } from 'url';
import express from 'express';
import isPortReachable from 'is-port-reachable';
import next from 'next';
import { bootstrap } from '../src/backend';

const defaultServerPort = 3000;

async function getAvailablePort(dPort: number): Promise<number> {
  let port = dPort;
  while (await isPortReachable(port, { host: 'localhost' })) {
    console.log(`> Fail on http://localhost:${port} Trying on ${port + 1}`);
    port++;
  }
  return port;
}

// Prepare the renderer once the app is ready
export async function startServer({
  callback,
  isDev,
  nextAppDir,
  log,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callback?: (serverPort: number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  log?: any;
  nextAppDir: string;
  isDev: boolean;
}) {
  try {
    log?.info('app ready');
    const serverApp = express();
    const serverPort = await getAvailablePort(defaultServerPort);
    const nextApp = next({
      dev: isDev,
      dir: nextAppDir,
      hostname: 'localhost',
      port: serverPort,
    });
    const handle = nextApp.getRequestHandler();
    await nextApp.prepare();
    await bootstrap(serverApp);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createServer((req: any, res: any) => {
      const parsedUrl = parse(req.url, true);
      const { pathname } = parsedUrl;
      console.log({ pathname });
      if (pathname?.startsWith('/api') && !pathname?.startsWith('/api/auth')) {
        serverApp(req, res);
      } else {
        handle(req, res, parsedUrl);
      }
    }).listen(serverPort, () => {
      log?.info('server start');
      log?.info(`> Ready on http://localhost:${serverPort}`);
    });
    callback?.(serverPort);
  } catch (error) {
    log?.error(error);
  }
}
