import { CliConfig, CommandDescriptor, CommandDirective } from '@effect/cli';
import { Effect, Option } from 'effect';

type AnyCommandDescriptor = CommandDescriptor.Command<unknown>;

export interface PreviewCommandDescriptors {
  readonly root: AnyCommandDescriptor;
  readonly preview: AnyCommandDescriptor;
  readonly previewTag: unknown;
  readonly operation: AnyCommandDescriptor;
  readonly operationTag: unknown;
  readonly capabilities: AnyCommandDescriptor;
  readonly capabilitiesTag: unknown;
}

export interface PreviewInvocation {
  readonly selected: boolean;
  readonly subcommand: 'operation' | 'capabilities' | undefined;
  readonly json: boolean;
  readonly connection: string | undefined;
}

const notPreview: PreviewInvocation = {
  selected: false,
  subcommand: undefined,
  json: false,
  connection: undefined,
};

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

const optionValue = (value: unknown): unknown =>
  Option.isOption(value) ? Option.getOrUndefined(value) : undefined;

const commandNames = (descriptor: AnyCommandDescriptor): ReadonlyArray<string> =>
  Array.from(CommandDescriptor.getNames(descriptor));

const acceptsCommandName = (descriptor: AnyCommandDescriptor, value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const normalized = CliConfig.normalizeCase(CliConfig.defaultConfig, value);
  return commandNames(descriptor).some(
    (name) => CliConfig.normalizeCase(CliConfig.defaultConfig, name) === normalized
  );
};

/** Mirror Command.run's SetLogLevel rerun, after the root descriptor proves the option is valid. */
const removeLogLevelOptions = (argv: readonly string[]): ReadonlyArray<string> => {
  const filtered = argv.slice(0, 2);
  for (let index = 2; index < argv.length; index += 1) {
    const normalized = CliConfig.normalizeCase(CliConfig.defaultConfig, argv[index]);
    if (normalized === '--log-level') {
      index += 1;
      continue;
    }
    if (normalized.startsWith('--log-level=')) continue;
    filtered.push(argv[index]);
  }
  return filtered;
};

const parseRoot = (commands: PreviewCommandDescriptors, argv: readonly string[]) => {
  const rootName = commandNames(commands.root)[0];
  if (rootName === undefined) return Effect.dieMessage('Root command descriptor has no name');

  return CommandDescriptor.parse(
    commands.root,
    [rootName, ...argv.slice(2)],
    CliConfig.defaultConfig
  ).pipe(Effect.map((directive) => directive as CommandDirective.CommandDirective<unknown>));
};

const resolveGlobalBuiltIns = (commands: PreviewCommandDescriptors, argv: readonly string[]) =>
  parseRoot(commands, argv).pipe(
    Effect.flatMap((directive) => {
      if (
        directive !== undefined &&
        CommandDirective.isBuiltIn(directive) &&
        directive.option._tag === 'SetLogLevel'
      ) {
        const rerunArgv = removeLogLevelOptions(argv);
        return parseRoot(commands, rerunArgv).pipe(
          Effect.map((rerunDirective) => ({ argv: rerunArgv, directive: rerunDirective })),
          Effect.catchAll(() => Effect.succeed({ argv: rerunArgv, directive: undefined }))
        );
      }
      return Effect.succeed({ argv, directive });
    }),
    Effect.catchAll(() => Effect.succeed({ argv, directive: undefined }))
  );

const invocationFromParsed = (
  subcommand: 'operation' | 'capabilities',
  value: unknown
): PreviewInvocation => {
  const options = asRecord(value);
  const connection = optionValue(options?.connection);
  return {
    selected: true,
    subcommand,
    json: options?.json === true,
    connection: typeof connection === 'string' ? connection : undefined,
  };
};
const parsedSubcommand = (value: unknown): readonly [unknown, unknown] | undefined => {
  const subcommand = optionValue(asRecord(value)?.subcommand);
  return Array.isArray(subcommand) && subcommand.length === 2
    ? [subcommand[0], subcommand[1]]
    : undefined;
};

const invocationFromRootParsed = (
  commands: PreviewCommandDescriptors,
  value: unknown
): PreviewInvocation => {
  const selected = parsedSubcommand(value);
  if (!selected || selected[0] !== commands.previewTag) return notPreview;

  const child = parsedSubcommand(selected[1]);
  if (!child) return { ...notPreview, selected: true };
  if (child[0] === commands.capabilitiesTag) {
    return invocationFromParsed('capabilities', child[1]);
  }
  if (child[0] === commands.operationTag) {
    return invocationFromParsed('operation', child[1]);
  }
  return { ...notPreview, selected: true };
};

/**
 * Keep malformed or built-in preview invocations on a non-mutating layer too. The command names
 * still come from the command descriptors and use the same case-normalization as Effect CLI.
 */
const conservativePreviewInvocation = (
  commands: PreviewCommandDescriptors,
  argv: readonly string[]
): PreviewInvocation => {
  if (!acceptsCommandName(commands.preview, argv[2])) return notPreview;

  const subcommandArg = argv[3];
  return {
    selected: true,
    subcommand: acceptsCommandName(commands.capabilities, subcommandArg)
      ? 'capabilities'
      : acceptsCommandName(commands.operation, subcommandArg)
        ? 'operation'
        : undefined,
    json: false,
    connection: undefined,
  };
};

/** Resolve the invocation with Effect CLI's parser before selecting any application layer. */
export const getPreviewInvocation = (
  commands: PreviewCommandDescriptors,
  argv: readonly string[]
) => {
  return resolveGlobalBuiltIns(commands, argv).pipe(
    Effect.flatMap(({ argv: resolvedArgv, directive }) => {
      // A successfully parsed user command is authoritative, including arguments after `--`.
      // Inspect the parser's selected command tags rather than guessing from process.argv indexes.
      if (directive !== undefined && CommandDirective.isUserDefined(directive)) {
        return Effect.succeed(invocationFromRootParsed(commands, directive.value));
      }

      // Failed and built-in parses retain a command-position fallback so malformed preview
      // invocations still avoid the mutating application layer.
      return Effect.succeed(conservativePreviewInvocation(commands, resolvedArgv));
    })
  );
};
