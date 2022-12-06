import { bootstrap, getAvailablePort } from './bootstrap';

(async () => {
  const port = await getAvailablePort(process.env.PORT || 3000);
  await bootstrap(port);
})();
