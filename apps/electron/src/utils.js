import isPortReachable from 'is-port-reachable';

export async function getAvailablePort(dPort) {
  let port = Number(dPort);
  const host = 'localhost';
  while (await isPortReachable(port, { host })) {
    console.log(`> Fail on http://${host}:${port} Trying on ${port + 1}`);
    port++;
  }
  return port;
}
