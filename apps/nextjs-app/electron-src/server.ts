import { createServer } from 'http';
import { parse } from 'url';
import express from 'express';
import isPortReachable from 'is-port-reachable';
import next from 'next';
import { bootstrap } from '../server-src';

const defaultServerPort = 3000;

async function getReachablePort(dPort: number): Promise<number> {
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
    const nextApp = next({ dev: isDev, dir: nextAppDir });
    const handle = nextApp.getRequestHandler();
    log?.info('app ready');
    const serverApp = express();
    const serverPort = await getReachablePort(defaultServerPort);
    await nextApp.prepare();
    await bootstrap(serverApp);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createServer((req: any, res: any) => {
      const parsedUrl = parse(req.url, true);
      const { pathname } = parsedUrl;
      console.log({ pathname });
      if (pathname?.startsWith('/api')) {
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
