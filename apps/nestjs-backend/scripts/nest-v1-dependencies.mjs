import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const baselineFile = 'community/apps/nestjs-backend/scripts/nest-v1-dependencies.baseline.json';
const backendRoots = ['community/apps/nestjs-backend/src', 'enterprise/backend-ee/src'];
const engineDirectories = [
  'features/record/',
  'features/field/',
  'features/view/',
  'features/table/',
  'features/calculation/',
  'features/selection/',
  'features/aggregation/',
  'features/undo-redo/',
  'features/reference/',
  'features/graph/',
  'features/table-domain/',
  'db-provider/',
];

// These are retained host infrastructure, not an alternate table engine.
const hostFiles = new Set([
  'features/table/table-index.service.ts',
  'features/record/cross-base-link-access.service.ts',
  'features/record/record-permission.service.ts',
  'features/record/share-view-scope.service.ts',
  'features/record/cross-base-link-access.field-operation.plugin.ts',
  'features/record/cross-base-link-access.record-write.plugin.ts',
  'features/record/cross-base-link-access.plugin-registrar.ts',
  'features/record/link-title-record-create-permission.plugin.ts',
  'features/record/symmetric-field-permission.field-operation.plugin.ts',
  'features/selection/raw-copy-content.ts',
  'features/aggregation/open-api/provision-ready-cache.ts',
  'features/table/open-api/table-audit.constants.ts',
  'features/table/open-api/table-mutation-cache-invalidator.ts',
  'features/undo-redo/open-api/undo-redo-engine-preference.ts',
  'db-provider/db.provider.interface.ts',
  'db-provider/db.provider.ts',
  'db-provider/db-provider.module.ts',
  'db-provider/postgres.provider.ts',
]);
const injectionHelpers = new Set([
  'IRecordQueryBuilder',
  'InjectRecordQueryBuilder',
  'InjectAggregationService',
  'AGGREGATION_SERVICE_SYMBOL',
  'RECORD_QUERY_BUILDER_SYMBOL',
  'IAggregationService',
  'InjectRecordQueryDialect',
  'RECORD_QUERY_DIALECT_SYMBOL',
  'RecordQueryDialectProvider',
]);
const mixedImplementations = new Set([
  'features/base/base-duplicate.service.ts',
  'features/base/base-import.service.ts',
  'features/base/base-export.service.ts',
]);
const portable = (path) => path.replaceAll('\\', '/');

function backendPath(path) {
  for (const root of backendRoots) {
    if (path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  }
}

function isV2(path) {
  const parts = path.split('/');
  return parts.includes('v2') || /(?:^|[-.])v2(?:[-.]|$)/.test(parts.at(-1));
}

function isEngine(path) {
  const local = backendPath(path);
  return (
    local !== undefined &&
    !isV2(path) &&
    !hostFiles.has(local) &&
    engineDirectories.some((prefix) => local.startsWith(prefix))
  );
}

function productionFiles(root) {
  const result = [];
  for (const backend of backendRoots) {
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
          continue;
        }
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (
          /\.(?:ts|tsx|mts|cts)$/.test(entry.name) &&
          !/\.(?:spec|test|d)\.[cm]?tsx?$/.test(entry.name)
        ) {
          result.push(path);
        }
      }
    };
    // Missing source roots are an error, never a vacuous successful scan.
    walk(resolve(root, backend));
  }
  return result.sort();
}

/** Build a bounded symbol graph: never load Nest, Prisma, v2 packages or node_modules. */
export function collectDependencies(root) {
  root = resolve(root);
  const files = productionFiles(root);
  const sourceSet = new Set(files);
  const options = {
    noResolve: true,
    noLib: true,
    types: [],
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    experimentalDecorators: true,
  };
  const host = ts.createCompilerHost(options);
  const originalGetSource = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version) =>
    sourceSet.has(file) ? originalGetSource(file, version) : undefined;
  const moduleOptions = backendRoots.map((backend) => {
    const configPath = resolve(root, backend, '../tsconfig.json');
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath));
    const invalidOptions = parsed.errors.filter((error) => error.code !== 18003);
    if (invalidOptions.length) throw new Error(`Invalid compiler options: ${configPath}`);
    return parsed.options;
  });
  const caches = moduleOptions.map((options) =>
    ts.createModuleResolutionCache(root, (path) => path, options)
  );
  const resolveBackendModule = (name, containingFile) => {
    const index = containingFile.startsWith(resolve(root, backendRoots[1])) ? 1 : 0;
    const module = ts.resolveModuleName(
      name,
      containingFile,
      moduleOptions[index],
      ts.sys,
      caches[index]
    ).resolvedModule;
    return module && sourceSet.has(module.resolvedFileName) ? module : undefined;
  };
  host.resolveModuleNames = (names, containingFile) =>
    names.map((name) => resolveBackendModule(name, containingFile));
  const program = ts.createProgram(files, options, host);
  const syntaxErrors = program.getSyntacticDiagnostics();
  if (syntaxErrors.length) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(syntaxErrors, host));
  }
  const checker = program.getTypeChecker();
  const dependencyMap = new Map();
  const symbolTargets = new Map();

  const unalias = (symbol) =>
    symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;

  function targets(value, seen = new Set()) {
    const symbol = resolveValue(value);
    if (!symbol || seen.has(symbol)) return [];
    if (symbolTargets.has(symbol)) return symbolTargets.get(symbol);
    seen.add(symbol);
    const result = [];
    for (const declaration of symbol.declarations ?? []) {
      if (ts.isSourceFile(declaration)) continue;
      const target = portable(relative(root, declaration.getSourceFile().fileName));
      const name =
        ts.isClassDeclaration(declaration) && declaration.name
          ? declaration.name.text
          : symbol.getName();
      if (
        isEngine(target) ||
        (mixedImplementations.has(backendPath(target)) && ts.isClassDeclaration(declaration))
      ) {
        result.push({
          target,
          symbol: name,
          service: /(?:Service|Module)$/.test(name) || injectionHelpers.has(name),
        });
      } else if (ts.isClassDeclaration(declaration)) {
        // EE wrappers retain their v1 identity through inheritance.
        for (const clause of declaration.heritageClauses ?? []) {
          if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
          for (const base of clause.types) {
            if (
              targets(checker.getSymbolAtLocation(base.expression), seen).some(
                (item) => item.service
              )
            ) {
              result.push({ target, symbol: name, service: true });
            }
          }
        }
      }
    }
    symbolTargets.set(symbol, result);
    return result;
  }

  function record(source, symbol, kind, owner = '') {
    const declarations = targets(symbol);
    for (const target of declarations) {
      if (source === target.target) continue;
      const scope = isV2(source)
        ? 'v2-host'
        : !isEngine(source) && target.service
          ? 'external-consumer'
          : undefined;
      if (!scope) continue;
      const edge = { scope, source, target: target.target, symbol: target.symbol, kind, owner };
      dependencyMap.set(JSON.stringify(edge), edge);
    }
  }

  function moduleSymbols(source, node, kind) {
    let symbol = unalias(checker.getSymbolAtLocation(node));
    if (!symbol && ts.isStringLiteralLike(node)) {
      const module = resolveBackendModule(node.text, node.getSourceFile().fileName);
      const file = module && program.getSourceFile(module.resolvedFileName);
      if (file) symbol = checker.getSymbolAtLocation(file);
    }
    if (!symbol) return;
    for (const member of checker.getExportsOfModule(symbol)) record(source, member, kind);
  }

  const requireModule = (node) =>
    node &&
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'require' &&
    !checker.getSymbolAtLocation(node.expression) &&
    node.arguments.length === 1 &&
    ts.isStringLiteralLike(node.arguments[0])
      ? node.arguments[0]
      : undefined;

  function moduleMember(node, name) {
    const module = resolveBackendModule(node.text, node.getSourceFile().fileName);
    const file = module && program.getSourceFile(module.resolvedFileName);
    const symbol = file && checker.getSymbolAtLocation(file);
    return symbol && checker.getExportsOfModule(symbol).find((member) => member.getName() === name);
  }

  /** Follow CommonJS require destructuring, which produces variable symbols, not class aliases. */
  function resolveValue(symbol) {
    symbol = unalias(symbol);
    for (const declaration of symbol?.declarations ?? []) {
      if (
        ts.isBindingElement(declaration) &&
        ts.isObjectBindingPattern(declaration.parent) &&
        !declaration.dotDotDotToken
      ) {
        const variable = declaration.parent.parent;
        const module = ts.isVariableDeclaration(variable) && requireModule(variable.initializer);
        if (module) {
          const name = (declaration.propertyName ?? declaration.name).getText();
          return moduleMember(module, name) ?? symbol;
        }
      }
      if (
        ts.isVariableDeclaration(declaration) &&
        ts.isIdentifier(declaration.name) &&
        declaration.initializer
      ) {
        const initializer = declaration.initializer;
        const module =
          (ts.isPropertyAccessExpression(initializer) && requireModule(initializer.expression)) ||
          (ts.isElementAccessExpression(initializer) &&
            ts.isStringLiteralLike(initializer.argumentExpression) &&
            requireModule(initializer.expression));
        if (module) {
          const name = ts.isPropertyAccessExpression(initializer)
            ? initializer.name.text
            : initializer.argumentExpression.text;
          return moduleMember(module, name) ?? symbol;
        }
      }
    }
    return symbol;
  }

  function referencedSymbol(node) {
    const symbol = checker.getSymbolAtLocation(node);
    if (symbol) return symbol;
    const access = ts.isPropertyAccessExpression(node)
      ? node
      : ts.isIdentifier(node) &&
          ts.isPropertyAccessExpression(node.parent) &&
          node.parent.name === node
        ? node.parent
        : undefined;
    if (!access || !ts.isIdentifier(access.expression)) return undefined;
    const receiver = checker.getSymbolAtLocation(access.expression);
    for (const declaration of receiver?.declarations ?? []) {
      const module =
        ts.isVariableDeclaration(declaration) && requireModule(declaration.initializer);
      if (module) return moduleMember(module, access.name.text);
    }
  }

  function registrationOwner(node) {
    const role = node.name.text;
    for (let current = node.parent; current; current = current.parent) {
      if (
        ts.isClassDeclaration(current) ||
        ts.isVariableDeclaration(current) ||
        ts.isFunctionDeclaration(current)
      ) {
        return `${current.name?.getText() ?? '<anonymous>'}:${role}`;
      }
    }
    return `<module>:${role}`;
  }

  for (const file of program.getSourceFiles()) {
    const source = portable(relative(root, file.fileName));
    for (const statement of file.statements) {
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.name) record(source, checker.getSymbolAtLocation(clause.name), 'import');
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const binding of bindings.elements)
            record(source, checker.getSymbolAtLocation(binding.name), 'import');
        } else if (!clause || (bindings && ts.isNamespaceImport(bindings))) {
          moduleSymbols(source, statement.moduleSpecifier, 'import');
        }
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const module = requireModule(declaration.initializer);
          if (module && ts.isObjectBindingPattern(declaration.name)) {
            for (const element of declaration.name.elements) {
              if (element.dotDotDotToken) continue;
              const name = (element.propertyName ?? element.name).getText();
              const member = moduleMember(module, name);
              if (member) record(source, member, 'import');
            }
          } else if (module && ts.isIdentifier(declaration.name)) {
            moduleSymbols(source, module, 'import');
          }
        }
      } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
        const exports = statement.exportClause;
        if (exports && ts.isNamedExports(exports)) {
          for (const binding of exports.elements)
            record(source, checker.getSymbolAtLocation(binding.name), 'export');
        } else {
          moduleSymbols(source, statement.moduleSpecifier, 'export');
        }
      }
    }
    const visit = (node) => {
      if (
        ts.isConstructorDeclaration(node) ||
        (ts.isPropertyDeclaration(node) && ts.getDecorators(node)?.length)
      ) {
        const property = ts.isPropertyDeclaration(node);
        const owner = node.parent.name?.getText(file) ?? '<anonymous>';
        for (const input of property ? [node] : node.parameters) {
          const kind = property ? 'property-injection' : 'injection';
          const inspect = (child) => {
            if (ts.isIdentifier(child)) record(source, referencedSymbol(child), kind, owner);
            ts.forEachChild(child, inspect);
          };
          // Types and decorators cover @Inject(token), namespace and property injection.
          inspect(input);
          if (input.type) {
            const type = checker.getTypeFromTypeNode(input.type);
            for (const part of type.isUnion() ? type.types : [type]) {
              record(source, part.getSymbol(), kind, owner);
            }
          }
        }
      } else if (ts.isImportEqualsDeclaration(node)) {
        if (ts.isExternalModuleReference(node.moduleReference)) {
          moduleSymbols(source, node.moduleReference.expression, 'import');
        } else {
          record(source, checker.getSymbolAtLocation(node.name), 'import');
        }
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
        if (node.qualifier) record(source, checker.getSymbolAtLocation(node.qualifier), 'import');
        else moduleSymbols(source, node.argument.literal, 'import');
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (requireModule(node) &&
            !(ts.isVariableDeclaration(node.parent) && node.parent.initializer === node))) &&
        node.arguments.length === 1 &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        moduleSymbols(source, node.arguments[0], 'import');
      } else if (
        (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
        ['providers', 'imports', 'exports', 'useClass', 'useExisting', 'inject'].includes(
          node.name.text
        )
      ) {
        const seen = new Set();
        const inspect = (child) => {
          if (ts.isIdentifier(child)) {
            const symbol = referencedSymbol(child);
            record(source, symbol, 'provider', registrationOwner(node));
            if (symbol && !seen.has(symbol)) {
              seen.add(symbol);
              for (const declaration of symbol.declarations ?? []) {
                if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
                  inspect(declaration.initializer);
                }
              }
            }
          }
          ts.forEachChild(child, inspect);
        };
        if (ts.isShorthandPropertyAssignment(node)) {
          const symbol = checker.getShorthandAssignmentValueSymbol(node);
          for (const declaration of symbol?.declarations ?? []) {
            if (ts.isVariableDeclaration(declaration) && declaration.initializer)
              inspect(declaration.initializer);
          }
        } else {
          inspect(node.initializer);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return [...dependencyMap.values()].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b), 'en')
  );
}

export function compareDependencies(actual, baseline) {
  const keys = ['scope', 'source', 'target', 'symbol', 'kind', 'owner'];
  if (!Array.isArray(baseline)) throw new Error('Dependency baseline must be an array');
  const expected = new Map();
  for (const edge of baseline) {
    if (
      !edge ||
      Object.keys(edge).sort().join() !== [...keys].sort().join() ||
      keys.some((key) => typeof edge[key] !== 'string')
    ) {
      throw new Error('Invalid dependency baseline entry');
    }
    const key = JSON.stringify(Object.fromEntries(keys.map((name) => [name, edge[name]])));
    if (expected.has(key)) throw new Error(`Duplicate baseline entry: ${key}`);
    expected.set(key, edge);
  }
  const observed = new Map(actual.map((edge) => [JSON.stringify(edge), edge]));
  return {
    added: [...observed].filter(([key]) => !expected.has(key)).map(([, edge]) => edge),
    removed: [...expected].filter(([key]) => !observed.has(key)).map(([, edge]) => edge),
  };
}

export function checkDependencies(root) {
  const actual = collectDependencies(root);
  const baseline = JSON.parse(readFileSync(resolve(root, baselineFile), 'utf8'));
  const delta = compareDependencies(actual, baseline);
  if (delta.added.length || delta.removed.length) {
    const format = (edge) =>
      `${edge.scope}: ${edge.source} -> ${edge.target}#${edge.symbol} (${edge.kind}${edge.owner ? `:${edge.owner}` : ''})`;
    throw new Error(
      [
        ...delta.added.map((edge) => `NEW v1 dependency: ${format(edge)}`),
        ...delta.removed.map((edge) => `STALE baseline (remove this entry): ${format(edge)}`),
        'Do not grow the baseline. Migrate new consumers to v2; remove baseline entries with their dependencies.',
      ].join('\n')
    );
  }
  return actual;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    const report = args[0] === '--report' && args.length === 1;
    const rootArg = args[0] === '--root' && args.length === 2 ? args[1] : undefined;
    if (args.length && !report && !rootArg)
      throw new Error('Usage: node scripts/nest-v1-dependencies.mjs [--report | --root PATH]');
    const root = rootArg ? resolve(rootArg) : repositoryRoot;
    const edges = report ? collectDependencies(root) : checkDependencies(root);
    console.log(
      report
        ? JSON.stringify(edges, null, 2)
        : `Nest v1 dependency baseline matched: ${edges.length} edges.`
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
