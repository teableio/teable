import { v2TsdownBaseConfig } from '@teable/v2-tsdown-config';
import { defineConfig } from 'tsdown';

export default defineConfig({
  ...v2TsdownBaseConfig,
  entry: [
    'src/index.ts',
    'src/client/index.ts',
    'src/server/index.ts',
    'src/node/index.ts',
    'src/engine/index.ts',
    'src/pglite/index.ts',
  ],
});
