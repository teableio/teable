#!/usr/bin/env tsx
import { Command } from '@effect/cli';
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import { Effect } from 'effect';
import { root } from '../src/commands';

/**
 * Extract connection string from command line args
 */
const getConnectionFromArgs = (args: readonly string[]): string | undefined => {
  const connectionIndex = args.findIndex((arg) => arg === '-c' || arg === '--connection');
  return connectionIndex >= 0 && connectionIndex + 1 < args.length
    ? args[connectionIndex + 1]
    : undefined;
};

// Build CLI app
const cli = Command.run(root, {
  name: 'teable-devtools',
  version: '0.0.0',
});

// Run - Effect CLI expects full process.argv, it handles slicing internally
const connectionString = getConnectionFromArgs(process.argv);
const isDotteaInspect = process.argv.includes('dottea') && process.argv.includes('inspect');

const appLayer = isDotteaInspect
  ? (await import('../src/layers/OutputLive')).OutputLive
  : (await import('../src/layers/AppLayer')).FullLayer(connectionString);

const program = cli(process.argv).pipe(
  Effect.provide(appLayer),
  Effect.provide(NodeContext.layer)
) as Effect.Effect<void, unknown, never>;

NodeRuntime.runMain(program);
