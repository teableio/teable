import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';

import { escapePattern, mutations, transformMutation } from './scripts/computed-mutations.mjs';
import baseConfig from './vitest.config';

const mutationId = process.env.COMPUTED_MUTATION;
const mutation = mutations.find(({ id }) => id === mutationId);
if (mutationId && !mutation) throw new Error(`Unknown computed mutation: ${mutationId}`);
const selected = mutation ? [mutation] : mutations;
const sourcePath = mutation
  ? fileURLToPath(new URL(`../${mutation.file}`, import.meta.url))
  : undefined;
const evidencePath = process.env.COMPUTED_MUTATION_TRANSFORM_REPORT;
if (mutation && !evidencePath) throw new Error('Mutation transform evidence path is required');

// Preflight fails closed even if the intended module is no longer imported.
if (mutation) transformMutation(readFileSync(sourcePath, 'utf8'), mutation);

const config = mergeConfig(
  baseConfig,
  defineConfig({
    plugins: mutation
      ? [
          {
            name: `computed-mutation:${mutation.id}`,
            enforce: 'pre',
            transform(source, id) {
              if (id.split('?')[0] !== sourcePath) return;
              const code = transformMutation(source, mutation);
              writeFileSync(evidencePath, JSON.stringify({ id: mutation.id, file: mutation.file }));
              return { code, map: null };
            },
          },
        ]
      : [],
    test: {
      testNamePattern: selected.map(({ testName }) => escapePattern(testName)).join('|'),
      passWithNoTests: false,
      retry: 0,
      bail: 0,
      fileParallelism: false,
      reporters: ['default', './scripts/computed-mutation-reporter.mjs'],
    },
  })
);

// Vite concatenates arrays while merging; replace the broad base include explicitly.
config.test.include = [...new Set(selected.map(({ testFile }) => testFile))];
export default config;
