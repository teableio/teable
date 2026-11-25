// @ts-check

const { dirname, isAbsolute, resolve, sep } = require('node:path');
const { fileURLToPath } = require('node:url');
const { createImportBoundaryVisitors } = require('./v2-import-boundary');

const repositoryRoot = resolve(__dirname, '../../../../..');
const prismaAdapterRoot = resolve(repositoryRoot, 'packages/app-platform/identity-adapter-prisma');
const hostDirectories = ['community/apps/nestjs-backend', 'enterprise/backend-ee'].map((path) =>
  resolve(repositoryRoot, path)
);
const prismaDirectories = ['community/packages/db-main-prisma', 'packages/db-main-prisma'].map(
  (path) => resolve(repositoryRoot, path)
);

/** @param {string} target @param {string} root */
const within = (target, root) => target === root || target.startsWith(`${root}${sep}`);
/** @param {string} source @param {string} name */
const packageMatches = (source, name) => source === name || source.startsWith(`${name}/`);
/** @param {string} source @param {string} filename */
const isBlocked = (source, filename) => {
  const allowsPrisma = within(resolve(filename), prismaAdapterRoot);
  if (
    source.startsWith('@nestjs/') ||
    ['express', 'nestjs-cls', '@teable/backend', '@teable/backend-ee'].some((name) =>
      packageMatches(source, name)
    )
  )
    return true;
  if (
    !allowsPrisma &&
    [
      '@prisma/client',
      '.prisma/client',
      '@teable/db-main-prisma',
      '@teable/db-main-prisma-ee',
    ].some((name) => packageMatches(source, name))
  )
    return true;
  if (!source.startsWith('.') && !isAbsolute(source) && !source.startsWith('file:')) return false;
  const target = source.startsWith('file:')
    ? fileURLToPath(source)
    : resolve(dirname(filename), source);
  const normalized = target.split(sep).join('/');
  return (
    hostDirectories.some((root) => within(target, root)) ||
    /\/node_modules\/(?:@nestjs\/[^/]+|express|nestjs-cls)(?:\/|$)/.test(normalized) ||
    (!allowsPrisma &&
      (prismaDirectories.some((root) => within(target, root)) ||
        /\/node_modules\/(?:@prisma\/client|\.prisma\/client)(?:\/|$)/.test(normalized)))
  );
};

const noAppPlatformHostImport = {
  meta: {
    type: 'problem',
    messages: {
      host: "App Platform packages must not import '{{name}}'. Keep Nest, Express and CLS in the host; Prisma belongs only in the identity-adapter-prisma package.",
    },
    schema: [],
  },
  /** @param {any} context */
  create(context) {
    return createImportBoundaryVisitors(context, isBlocked, 'host');
  },
};

module.exports = { noAppPlatformHostImport };
