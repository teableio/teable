const path = require('path');
const glob = require('glob');

function collectWorkerEntries() {
  const workerFiles = glob.sync(path.join(__dirname, 'src/worker/**.ts'));
  return workerFiles.reduce((acc, file) => {
    const relativePath = path.relative(path.join(__dirname, 'src/worker'), file);
    const entryName = `worker/${path.dirname(relativePath)}/${path.basename(relativePath, '.ts')}`;
    acc[entryName] = file;
    return acc;
  }, {});
}

/**
 * Add '@teable/source' so workspace packages resolve to source exports during monorepo
 * builds, and 'import' so ESM-only packages resolve through their exports map.
 */
function withSourceConditions(baseConditionNames) {
  const next = [...(baseConditionNames ?? ['require', 'node', 'default'])];
  const ensureBeforeDefault = (condition) => {
    if (next.includes(condition)) {
      return;
    }
    const defaultIndex = next.indexOf('default');
    if (defaultIndex === -1) {
      next.push(condition);
    } else {
      next.splice(defaultIndex, 0, condition);
    }
  };
  ensureBeforeDefault('@teable/source');
  ensureBeforeDefault('import');
  return next;
}

const mailTemplatePatterns = [{ from: 'src/features/mail-sender/templates', to: 'templates' }];

/**
 * SWC's decorator-metadata emit references interface-typed constructor params as
 * `typeof IFoo === 'undefined' ? Object : IFoo`, which keeps type-only imports alive. tsc
 * elides them; Rspack's ESM linker otherwise reports every such import as a missing export.
 * The runtime guard makes them harmless, so report them as warnings (Nest's defaults hide
 * non-critical warnings) instead of failing the build.
 */
function withLenientExportsPresence(moduleOptions) {
  return {
    ...moduleOptions,
    parser: {
      ...moduleOptions?.parser,
      javascript: {
        ...moduleOptions?.parser?.javascript,
        exportsPresence: 'warn',
      },
    },
  };
}

// Nest's rspack defaults only add this alias for ESM projects ("type": "module"). This app emits
// CommonJS but writes ESM-style specifiers (migration guide, "Moving your own code to ESM"), so
// `./x.js` in a .ts file must resolve to `./x.ts` here just as it does for tsc and vitest.
const esmExtensionAlias = {
  '.js': ['.ts', '.js'],
  '.mjs': ['.mts', '.mjs'],
};

// Nest's rspack pipeline keeps ES-module syntax until rspack emits the CommonJS bundle, and rspack
// leaves `import.meta.dirname` / `import.meta.filename` untouched (Node then even sniffs the bundle
// as ESM and refuses its `require` calls). This maps them to the bundle's own runtime globals, the
// same lowering swc applies when it emits CommonJS itself, so source files can use the ESM form from
// the NestJS 12 migration guide today. `process.getBuiltinModule` (Node >= 22.3) avoids naming
// `require`, which a module may shadow with `createRequire(import.meta.url)`.
const createImportMetaShim = (rspack) =>
  new rspack.DefinePlugin({
    'import.meta.dirname': '__dirname',
    'import.meta.filename': '__filename',
    'import.meta.url': 'process.getBuiltinModule("node:url").pathToFileURL(__filename).href',
  });

module.exports = {
  esmExtensionAlias,
  createImportMetaShim,
  collectWorkerEntries,
  withSourceConditions,
  withLenientExportsPresence,
  mailTemplatePatterns,
};
