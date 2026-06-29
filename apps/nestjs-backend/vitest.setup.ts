import { Buffer as NodeBuffer } from 'node:buffer';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const bufferModule = require('buffer') as { Buffer: typeof NodeBuffer; SlowBuffer?: unknown };
bufferModule.SlowBuffer ??= bufferModule.Buffer ?? NodeBuffer;
