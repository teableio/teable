// @ts-check

const { dirname, isAbsolute, resolve, sep } = require('node:path');
const { fileURLToPath } = require('node:url');

/**
 * Import boundary for the v2 packages (`community/packages/v2/*`).
 *
 * v2 is the Table bounded context; it must not depend on the v1 table core or
 * on the NestJS host. This rule is deliberately a separate rule name instead of
 * reusing the native `no-restricted-imports`: the SSRF preset owns that native
 * rule (warn, with spec-file exemptions), so reusing it would either drop the
 * SSRF policy or let this boundary inherit the spec-file exemption.
 *
 * See docs/engineering/v1-table-core-removal.md (P0-1).
 */
const BLOCKED_PACKAGES = [
  '@teable/core',
  '@teable/openapi',
  '@teable/db-main-prisma',
  '@teable/backend',
  '@teable/backend-ee',
];

const packagesRoot = resolve(__dirname, '../../..');
const BLOCKED_DIRECTORIES = [
  resolve(packagesRoot, 'core'),
  resolve(packagesRoot, 'openapi'),
  resolve(packagesRoot, 'db-main-prisma'),
  resolve(packagesRoot, '../apps/nestjs-backend'),
  resolve(packagesRoot, '../../enterprise/backend-ee'),
];

/** @param {string} source @param {string} filename */
const isBlocked = (source, filename) => {
  if (BLOCKED_PACKAGES.some((name) => source === name || source.startsWith(`${name}/`))) {
    return true;
  }
  if (!source.startsWith('.') && !isAbsolute(source) && !source.startsWith('file:')) {
    return false;
  }
  const target = source.startsWith('file:')
    ? fileURLToPath(source)
    : resolve(dirname(filename), source);
  return BLOCKED_DIRECTORIES.some((root) => target === root || target.startsWith(`${root}${sep}`));
};

/**
 * The specifier of a static module source, dynamic import, TS import type or
 * require() call, when it is a string literal.
 * @param {any} node
 * @returns {string | undefined}
 */
const readSpecifier = (node) => {
  if (!node || typeof node !== 'object') return undefined;
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string' ? node.value : undefined;
    case 'TemplateLiteral':
      return node.expressions?.length === 0 && node.quasis?.length === 1
        ? node.quasis[0].value?.cooked
        : undefined;
    default:
      return undefined;
  }
};

const noLegacyCoreImport = {
  meta: {
    type: 'problem',
    messages: {
      legacy:
        "v2 packages must not import '{{name}}'. It belongs to the v1 table core or the NestJS host; use a @teable/v2-* package, and keep host concepts in Nest. Boundary: community/packages/eslint-config-bases/src/bases/v2-import-boundary.json.",
    },
    schema: [],
  },
  /** @param {any} context */
  create(context) {
    /** @param {any} node @param {any} sourceNode */
    const check = (node, sourceNode) => {
      const name = readSpecifier(sourceNode);
      if (name === undefined || !isBlocked(name, context.filename)) return;
      context.report({ node, messageId: 'legacy', data: { name } });
    };

    return {
      /** @param {any} node */
      ImportDeclaration(node) {
        check(node.source, node.source);
      },
      /** @param {any} node */
      ExportNamedDeclaration(node) {
        if (node.source) check(node.source, node.source);
      },
      /** @param {any} node */
      ExportAllDeclaration(node) {
        if (node.source) check(node.source, node.source);
      },
      /** @param {any} node */
      ImportExpression(node) {
        check(node.source, node.source);
      },
      /** @param {any} node */
      TSImportType(node) {
        check(node, node.source);
      },
      /** @param {any} node */
      TSImportEqualsDeclaration(node) {
        const reference = node.moduleReference;
        if (reference?.type === 'TSExternalModuleReference') {
          check(reference.expression, reference.expression);
        }
      },
      /** @param {any} node */
      CallExpression(node) {
        const isRequire =
          node.callee?.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments?.length === 1;
        if (isRequire) check(node.arguments[0], node.arguments[0]);
      },
    };
  },
};

module.exports = { noLegacyCoreImport };
