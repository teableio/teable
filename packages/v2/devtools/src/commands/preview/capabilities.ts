import { Command, Options } from '@effect/cli';
import type { PreviewCapability } from '@teable/v2-command-explain';
import type { Option } from 'effect';
import { Effect } from 'effect';

import { PreviewCapabilities } from '../../services';
import { connectionOption } from '../shared';

const jsonOption = Options.boolean('json').pipe(
  Options.withDefault(false),
  Options.withDescription('Print the HTTP-compatible capability DTO as JSON')
);

export const renderPreviewCapabilities = (
  capabilities: ReadonlyArray<PreviewCapability>
): string => {
  if (capabilities.length === 0) return 'No preview operations are registered.';

  const lines = ['Preview capabilities:'];
  for (const capability of capabilities) {
    lines.push(`  - ${capability.operation} [${capability.supportLevel}]`);
    lines.push(`      write route: ${capability.canonicalWriteRoute}`);
    lines.push(`      permission: ${capability.requiredPermissionScope}`);
    lines.push(`      detail levels: ${capability.detailLevels.join(', ')}`);
    if (capability.limitations.length === 0) {
      lines.push('      limitations: none reported');
    } else {
      lines.push('      limitations:');
      for (const limitation of capability.limitations) {
        lines.push(`        - ${limitation}`);
      }
    }
  }
  return lines.join('\n');
};

const handler = (args: { readonly connection: Option.Option<string>; readonly json: boolean }) =>
  Effect.gen(function* () {
    const previewCapabilities = yield* PreviewCapabilities;
    const capabilities = yield* previewCapabilities.list();
    yield* Effect.sync(() => {
      console.log(
        args.json ? JSON.stringify(capabilities, null, 2) : renderPreviewCapabilities(capabilities)
      );
    });
  });

export const previewCapabilities = Command.make(
  'capabilities',
  { connection: connectionOption, json: jsonOption },
  handler
).pipe(Command.withDescription('List operations from the canonical in-process preview registry'));
