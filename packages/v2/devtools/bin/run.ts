#!/usr/bin/env tsx
import { Command } from '@effect/cli';
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import { Cause, Effect } from 'effect';
import { root } from '../src/commands';
import { preview, previewCapabilities, previewOperation } from '../src/commands/preview';
import { getPreviewInvocation } from '../src/utils/cliInvocation';

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
const previewInvocation = await Effect.runPromise(
  getPreviewInvocation(
    {
      root: root.descriptor,
      preview: preview.descriptor,
      previewTag: preview.tag,
      operation: previewOperation.descriptor,
      operationTag: previewOperation.tag,
      capabilities: previewCapabilities.descriptor,
      capabilitiesTag: previewCapabilities.tag,
    },
    process.argv
  ).pipe(Effect.provide(NodeContext.layer))
);
const connectionString = previewInvocation.connection ?? getConnectionFromArgs(process.argv);
const isDotteaInspect = process.argv.includes('dottea') && process.argv.includes('inspect');
// Repro builds its own in-memory runtime; the Database layer would eagerly open
// the default local connection even for a --structure-only run.
const isRepro = process.argv.includes('repro');

const appLayer = previewInvocation.selected
  ? previewInvocation.subcommand === 'capabilities'
    ? (await import('../src/layers/AppLayer')).PreviewCapabilitiesLayer
    : (await import('../src/layers/AppLayer')).PreviewLayer(connectionString, {
        diagnostics: previewInvocation.json ? 'stderr' : 'default',
      })
  : isDotteaInspect
    ? (await import('../src/layers/OutputLive')).OutputLive
    : isRepro
      ? (await import('../src/layers/ReproLayer')).ReproLayer
      : (await import('../src/layers/AppLayer')).FullLayer(connectionString);

const program = cli(process.argv).pipe(
  Effect.provide(appLayer),
  Effect.provide(NodeContext.layer)
) as Effect.Effect<void, unknown, never>;

if (previewInvocation.json) {
  // The preview handler reports stable errors itself. Preserve unexpected causes on stderr
  // while disabling runMain's stdout-oriented pretty reporter for the JSON protocol.
  const jsonProgram = program.pipe(
    Effect.tapErrorCause((cause) =>
      Effect.sync(() => {
        process.stderr.write(`${Cause.pretty(cause)}\n`);
      })
    )
  );
  NodeRuntime.runMain(jsonProgram, {
    disableErrorReporting: true,
    disablePrettyLogger: true,
  });
} else {
  NodeRuntime.runMain(program);
}
