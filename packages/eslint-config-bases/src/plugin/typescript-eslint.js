// @ts-check

/**
 * typescript-eslint rules that oxlint has no faithful native version of, run
 * through oxlint's JS plugin API.
 *
 * - naming-convention: oxlint has no native rule.
 * - consistent-type-imports: oxlint's rule turns NestJS constructor injection
 *   (`constructor(private foo: Foo)` in a decorated class) into `import type`,
 *   which erases the runtime class that decorator metadata needs. typescript-eslint
 *   leaves files with decorators alone when the project emits decorator metadata.
 *
 * Neither rule needs a type checker for our options, but both refuse to start
 * without TS-ESTree parser services, so they get empty maps, a null program
 * and the decorator flags of the file's tsconfig.
 *
 * Oxlint cannot load a JS plugin under the reserved `@typescript-eslint` name,
 * so the rules are exposed as `teable/*` while the codebase keeps its
 * `eslint-disable @typescript-eslint/<rule>` comments; the wrapper applies
 * those comments itself.
 */

const path = require('node:path');
const { rules } = require('@typescript-eslint/eslint-plugin');
const ts = require('typescript');

const DIRECTIVE =
  /^\s*(eslint-disable|eslint-enable|eslint-disable-line|eslint-disable-next-line)\s+(.*?)(?:\s+--\s.*)?\s*$/s;

/** @type {Map<string, boolean>} */
const decoratorMetadataByConfig = new Map();

/**
 * Whether the tsconfig that owns `filename` emits decorator metadata.
 * @param {string} filename
 */
const emitsDecoratorMetadata = (filename) => {
  const configPath = ts.findConfigFile(path.dirname(filename), ts.sys.fileExists);
  if (!configPath) return false;
  let emits = decoratorMetadataByConfig.get(configPath);
  if (emits === undefined) {
    const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
    // Only compiler options are needed; skip enumerating the project's files.
    const host = { ...ts.sys, readDirectory: () => [] };
    const { options } = ts.parseJsonConfigFileContent(config, host, path.dirname(configPath));
    emits = Boolean(options.experimentalDecorators && options.emitDecoratorMetadata);
    decoratorMetadataByConfig.set(configPath, emits);
  }
  return emits;
};

/**
 * @typedef {{ line: number, column: number }} Position
 */

/**
 * @param {Position} a
 * @param {Position} b
 */
const isBefore = (a, b) => a.line < b.line || (a.line === b.line && a.column < b.column);

/**
 * Collects the lines and ranges that `eslint-disable` comments naming `ruleId`
 * exempt, following ESLint: `eslint-disable`/`eslint-enable` count only in
 * block comments, the `-line` variants in either comment style.
 * @param {any} sourceCode
 * @param {string} ruleId
 * @returns {(position: Position) => boolean}
 */
const legacySuppressions = (sourceCode, ruleId) => {
  /** @type {Set<number>} */
  const lines = new Set();
  /** @type {Array<{ start: Position, end: Position | null }>} */
  const ranges = [];
  for (const comment of sourceCode.getAllComments()) {
    const match = DIRECTIVE.exec(comment.value);
    if (!match) continue;
    const [, kind, list] = match;
    if (!list.split(',').some((rule) => rule.trim() === ruleId)) continue;
    if (kind === 'eslint-disable-line') {
      lines.add(comment.loc.start.line);
    } else if (kind === 'eslint-disable-next-line') {
      lines.add(comment.loc.end.line + 1);
    } else if (comment.type !== 'Block') {
      continue;
    } else if (kind === 'eslint-disable') {
      ranges.push({ start: comment.loc.start, end: null });
    } else {
      const open = ranges.find((range) => range.end === null);
      if (open) open.end = comment.loc.start;
    }
  }
  return (position) =>
    lines.has(position.line) ||
    ranges.some(
      (range) =>
        !isBefore(position, range.start) && (range.end === null || isBefore(position, range.end))
    );
};

/**
 * Forwards every property to `target` except `overrides`. The proxy target is
 * an empty object because oxlint's context exposes frozen data properties
 * that a proxy over the real object could not replace.
 * @param {any} target
 * @param {Record<string, unknown>} overrides
 */
const forward = (target, overrides) =>
  new Proxy(
    {},
    {
      get(_, key) {
        if (typeof key === 'string' && key in overrides) return overrides[key];
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      has(_, key) {
        return key in overrides || key in target;
      },
    }
  );

/**
 * @param {'naming-convention' | 'consistent-type-imports'} name
 */
const wrap = (name) => {
  const tsRule = /** @type {any} */ (rules[name]);
  const legacyRuleId = `@typescript-eslint/${name}`;
  return {
    meta: tsRule.meta,
    defaultOptions: tsRule.defaultOptions,
    /** @param {any} context */
    create(context) {
      const isSuppressed = legacySuppressions(context.sourceCode, legacyRuleId);
      const decoratorMetadata = emitsDecoratorMetadata(context.filename);
      const parserServices = {
        esTreeNodeToTSNodeMap: new WeakMap(),
        tsNodeToESTreeNodeMap: new WeakMap(),
        program: null,
        emitDecoratorMetadata: decoratorMetadata,
        experimentalDecorators: decoratorMetadata,
      };
      return tsRule.create(
        forward(context, {
          sourceCode: forward(context.sourceCode, { parserServices }),
          /** @param {any} descriptor */
          report(descriptor) {
            const loc = descriptor.loc ?? descriptor.node.loc;
            if (isSuppressed(loc.start ?? loc)) return;
            context.report(descriptor);
          },
        })
      );
    },
  };
};

module.exports = {
  consistentTypeImports: wrap('consistent-type-imports'),
  namingConvention: wrap('naming-convention'),
};
