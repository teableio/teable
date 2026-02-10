import { v2TsdownBaseConfig } from '@teable/v2-tsdown-config';
import { defineConfig } from 'tsdown';

export default defineConfig({
  ...v2TsdownBaseConfig,
  entry: ['src/index.ts', 'src/handlers/index.ts'],
});
