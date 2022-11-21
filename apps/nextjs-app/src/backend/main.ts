import http from 'http';
import express from 'express';
import { bootstrap } from './index';

const serverApp = express();
bootstrap(serverApp);

http.createServer(serverApp).listen(4000, () => {
  console.log(`nest server ready on http://localhost:${4000}`);
});
