import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const callbackName = '__TEABLE_RECORD_UPDATE_RETENTION__';
const targetFile = fileURLToPath(
  new URL('../../../core/src/application/services/RecordBulkUpdateService.ts', import.meta.url)
);

const checkpointNames = [
  'loaded',
  'batchPrepared',
  'prepared',
  'persisted',
  'eventsBuilt',
  'resultBuilt',
  'undoReady',
  'undoAppended',
] as const;

type Checkpoint = (typeof checkpointNames)[number];
type Insertion = { position: number; code: string };

function drift(site: string, detail: string): never {
  throw new Error(
    `Record-update retention instrumentation drift at ${site}: ${detail}. ` +
      'Review RecordBulkUpdateService.ts and update the diagnostic AST anchors before profiling.'
  );
}

function exactlyOne<T>(values: ReadonlyArray<T>, site: string): T {
  if (values.length !== 1) drift(site, `expected exactly one anchor, found ${values.length}`);
  return values[0]!;
}

function descendants<T extends ts.Node>(
  root: ts.Node,
  predicate: (node: ts.Node) => node is T
): T[] {
  const matches: T[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return matches;
}

function named(node: ts.Node | undefined, name: string): boolean {
  return node !== undefined && ts.isIdentifier(node) && node.text === name;
}

function isTrace(expression: ts.Expression | undefined, phase: string): boolean {
  if (!expression) return false;
  if (ts.isYieldExpression(expression)) {
    if (!expression.asteriskToken || !expression.expression) return false;
    expression = expression.expression;
  }
  if (!ts.isAwaitExpression(expression)) return false;
  const call = expression.expression;
  const phaseArgument = ts.isCallExpression(call) ? call.arguments[1] : undefined;
  return (
    ts.isCallExpression(call) &&
    named(call.expression, 'traceRecordBulkUpdatePhase') &&
    call.arguments.length === 4 &&
    phaseArgument !== undefined &&
    ts.isStringLiteral(phaseArgument) &&
    phaseArgument.text === phase
  );
}

function variable(root: ts.Node, name: string): ts.VariableStatement {
  const declaration = exactlyOne(
    descendants(
      root,
      (node): node is ts.VariableDeclaration =>
        ts.isVariableDeclaration(node) && named(node.name, name)
    ),
    name
  );
  const list = declaration.parent;
  if (
    !ts.isVariableDeclarationList(list) ||
    list.declarations.length !== 1 ||
    (list.flags & ts.NodeFlags.BlockScoped) === 0 ||
    !ts.isVariableStatement(list.parent) ||
    !ts.isBlock(list.parent.parent)
  ) {
    drift(name, 'expected a single block-scoped variable statement');
  }
  return list.parent;
}

function traceVariable(root: ts.Node, name: string, phase: string): ts.VariableStatement {
  const statement = variable(root, name);
  if (!isTrace(statement.declarationList.declarations[0]!.initializer, phase)) {
    drift(name, `expected initialization by traceRecordBulkUpdatePhase(..., '${phase}', ...)`);
  }
  return statement;
}

function traceStatement(root: ts.Node, phase: string): ts.ExpressionStatement {
  return exactlyOne(
    descendants(
      root,
      (node): node is ts.ExpressionStatement =>
        ts.isExpressionStatement(node) && isTrace(node.expression, phase)
    ),
    phase
  );
}

function isFunctionLike(
  node: ts.Node
): node is
  | ts.MethodDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.FunctionDeclaration {
  return (
    ts.isMethodDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node)
  );
}

// Bindings declared in this block must already be initialized when the probe runs.
function declaredBefore(
  block: ts.Block,
  anchor: ts.Statement,
  wanted: ReadonlyArray<string>,
  site: Checkpoint
): string[] {
  const declared: string[] = [];
  for (const statement of block.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const name = declaration.name.text;
      if (!wanted.includes(name)) continue;
      if (statement.end > anchor.getStart() || !declaration.initializer) {
        drift(site, `${name} binding is not initialized before the checkpoint`);
      }
      declared.push(name);
    }
  }
  return declared;
}

function parameterBindings(scope: ts.Node): string[] {
  if (!isFunctionLike(scope)) return [];
  return scope.parameters.flatMap((parameter) =>
    ts.isIdentifier(parameter.name) ? [parameter.name.text] : []
  );
}

// Only bindings in enclosing blocks/functions count. A similarly named local in a
// sibling callback must not make a moved probe appear safe (or introduce a TDZ).
function assertVisible(anchor: ts.Statement, names: ReadonlyArray<string>, site: Checkpoint) {
  const visible = new Set<string>();
  for (let scope: ts.Node | undefined = anchor.parent; scope; scope = scope.parent) {
    if (ts.isBlock(scope)) {
      const pending = names.filter((name) => !visible.has(name));
      for (const name of declaredBefore(scope, anchor, pending, site)) visible.add(name);
    }
    for (const name of parameterBindings(scope)) visible.add(name);
  }
  const missing = names.filter((name) => !visible.has(name));
  if (missing.length > 0) drift(site, `roots/counters are not in scope: ${missing.join(', ')}`);
}

/** Intrusive, opt-in compiled-source probes; never write the instrumented service to disk. */
export function instrumentBulkUpdateSource(source: string): {
  code: string;
  checkpoints: ReadonlyArray<string>;
} {
  const file = ts.createSourceFile(
    targetFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  if (
    descendants(
      file,
      (node): node is ts.PropertyAccessExpression =>
        ts.isPropertyAccessExpression(node) &&
        named(node.expression, 'globalThis') &&
        named(node.name, callbackName)
    ).length > 0
  ) {
    drift('source', 'input already contains retention probes; use pristine source');
  }
  const service = exactlyOne(
    descendants(
      file,
      (node): node is ts.ClassDeclaration =>
        ts.isClassDeclaration(node) && named(node.name, 'RecordBulkUpdateService')
    ),
    'RecordBulkUpdateService'
  );
  const method = (name: string) => {
    const found = exactlyOne(
      service.members.filter(
        (member): member is ts.MethodDeclaration =>
          ts.isMethodDeclaration(member) && named(member.name, name)
      ),
      name
    );
    if (!found.body) drift(name, 'method has no body');
    return found.body;
  };
  const explicit = method('executeExplicitRecordUpdates');
  const update = method('update');
  const insertions: Insertion[] = [];
  const insert = (
    stage: Checkpoint,
    anchor: ts.Statement,
    side: 'before' | 'after',
    roots: string,
    counters: string,
    bindings: ReadonlyArray<string>
  ) => {
    if (!ts.isBlock(anchor.parent)) drift(stage, 'anchor is no longer a direct block statement');
    // For an after-probe, its declaration is also initialized and visible.
    const declared = ts.isVariableStatement(anchor)
      ? anchor.declarationList.declarations.flatMap((declaration) =>
          ts.isIdentifier(declaration.name) ? [declaration.name.text] : []
        )
      : [];
    assertVisible(
      anchor,
      bindings.filter((binding) => side !== 'after' || !declared.includes(binding)),
      stage
    );
    const lineStart = source.lastIndexOf('\n', anchor.getStart()) + 1;
    const indent = source.slice(lineStart, anchor.getStart());
    if (!/^\s*$/.test(indent)) drift(stage, 'anchor must start on its own line');
    // Optional-call arguments are not evaluated when the callback is absent:
    // no root/counter object is allocated in that case.
    const probe = `globalThis.${callbackName}?.('${stage}', { ${roots} }, { ${counters} });`;
    insertions.push({
      position: side === 'before' ? anchor.getStart() : anchor.end,
      code: side === 'before' ? `${probe}\n${indent}` : `\n${indent}${probe}`,
    });
  };

  const loaded = traceVariable(explicit, 'currentRecordsResult', 'loadExplicitCurrentRecords');
  insert(
    'loaded',
    loaded,
    'after',
    'inputRecords: records, resolvedUpdates, currentRecords: currentRecordsResult',
    'inputRows: records.length, resolvedRows: resolvedUpdates.length, loadedRows: currentRecordsResult.records.length',
    ['records', 'resolvedUpdates', 'currentRecordsResult']
  );

  const batchIncrement = exactlyOne(
    descendants(explicit, (node): node is ts.ExpressionStatement => {
      if (!ts.isExpressionStatement(node) || !ts.isBinaryExpression(node.expression)) return false;
      const expression = node.expression;
      return (
        named(expression.left, 'batchIndex') &&
        expression.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
        ts.isNumericLiteral(expression.right) &&
        expression.right.text === '1'
      );
    }),
    'batchIndex += 1'
  );
  if (!ts.isBlock(batchIncrement.parent) || !ts.isWhileStatement(batchIncrement.parent.parent)) {
    drift('batchPrepared', 'batch increment must remain in the batching while-loop');
  }
  const prepared = variable(explicit, 'authorizedSummary');
  const summary = prepared.declarationList.declarations[0]!.initializer;
  if (
    !summary ||
    !ts.isCallExpression(summary) ||
    !named(summary.expression, 'summarizeExplicitUpdates') ||
    summary.arguments.length !== 1 ||
    !named(summary.arguments[0], 'authorizedUpdates') ||
    batchIncrement.parent.parent.parent !== prepared.parent ||
    batchIncrement.parent.parent.end >= prepared.getStart() ||
    loaded.end >= batchIncrement.getStart()
  ) {
    drift('prepared', 'authorizedSummary must follow the batching loop in the same block');
  }
  const batchRoots =
    'preparedWrite, authorizedUpdates, fieldUpdateTargets, persistedBatches, fillLinkTitleSpecs, pendingEventData, responseFieldsByRecord, eventData';
  const batchBindings = batchRoots.split(', ');
  for (const [stage, anchor] of [
    ['batchPrepared', batchIncrement],
    ['prepared', prepared],
  ] as const) {
    insert(
      stage,
      anchor,
      'before',
      batchRoots,
      'batches: persistedBatches.length, preparedRows: resolvedIndex, maxBatchSize',
      [...batchBindings, 'resolvedIndex', 'maxBatchSize']
    );
  }

  const persisted = traceVariable(explicit, 'persistResult', 'updateManyStream');
  const eventsBuilt = traceStatement(explicit, 'buildPersistedEventData');
  const resultBuilt = traceStatement(explicit, 'materializeResultRecords');
  if (
    persisted.parent !== prepared.parent ||
    eventsBuilt.parent !== persisted.parent ||
    prepared.end >= persisted.getStart() ||
    persisted.end >= eventsBuilt.getStart() ||
    eventsBuilt.end >= resultBuilt.getStart()
  ) {
    drift('persisted', 'prepare, persist, event-build and result-build order or scopes changed');
  }
  insert(
    'persisted',
    persisted,
    'after',
    'preparedWrite, authorizedUpdates, fieldUpdateTargets, pendingEventData, responseFieldsByRecord, eventData, persistResult',
    'updatedRows: persistResult.totalUpdated',
    [
      'preparedWrite',
      'authorizedUpdates',
      'fieldUpdateTargets',
      'pendingEventData',
      'responseFieldsByRecord',
      'eventData',
      'persistResult',
    ]
  );
  insert(
    'eventsBuilt',
    eventsBuilt,
    'after',
    'preparedWrite, authorizedUpdates, responseFieldsByRecord, eventData, persistResult',
    'eventRows: eventData.length',
    ['preparedWrite', 'authorizedUpdates', 'responseFieldsByRecord', 'eventData', 'persistResult']
  );
  insert(
    'resultBuilt',
    resultBuilt,
    'after',
    'eventData, materializedRecords',
    'resultRows: materializedRecords.length, eventRows: eventData.length',
    ['eventData', 'materializedRecords']
  );

  const redo = variable(update, 'updateRedoCommands');
  const afterCommit = exactlyOne(
    descendants(update, (node): node is ts.ExpressionStatement => {
      if (!ts.isExpressionStatement(node) || !ts.isAwaitExpression(node.expression)) return false;
      const call = node.expression.expression;
      if (!ts.isCallExpression(call) || call.arguments.length !== 0) return false;
      const access = call.expression;
      return (
        ts.isPropertyAccessExpression(access) &&
        named(access.name, 'afterCommit') &&
        ts.isPropertyAccessExpression(access.expression) &&
        named(access.expression.name, 'pluginExecution') &&
        named(access.expression.expression, 'executionResult')
      );
    }),
    'executionResult.pluginExecution.afterCommit'
  );
  if (redo.parent !== afterCommit.parent || redo.end >= afterCommit.getStart()) {
    drift('undoReady', 'redo construction must precede afterCommit in the same block');
  }
  insert(
    'undoReady',
    redo,
    'after',
    'inputRecords: input.records, executionResult, updateUndoCommands, updateRedoCommands',
    [
      'undoCommands: updateUndoCommands.length',
      'redoCommands: updateRedoCommands.length',
      ...(['undo', 'redo'] as const).flatMap((side) => {
        const commands = side === 'undo' ? 'updateUndoCommands' : 'updateRedoCommands';
        return [
          `${side}RecordRows: ${commands}.reduce((count, command) => count + (command.type === 'UpdateRecords' ? command.payload.records.length : 0), 0)`,
          `${side}FieldAssignments: ${commands}.reduce((count, command) => count + (command.type === 'UpdateRecords' ? command.payload.records.reduce((rows, record) => rows + Object.keys(record.fields).length, 0) : 0), 0)`,
        ];
      }),
      'eventRows: executionResult.eventData.length',
    ].join(', '),
    ['input', 'executionResult', 'updateUndoCommands', 'updateRedoCommands']
  );
  insert(
    'undoAppended',
    afterCommit,
    'before',
    'executionResult',
    'eventRows: executionResult.eventData.length',
    ['executionResult']
  );

  let code = source;
  for (const insertion of insertions.sort((left, right) => right.position - left.position)) {
    code = code.slice(0, insertion.position) + insertion.code + code.slice(insertion.position);
  }
  return { code, checkpoints: [...checkpointNames] };
}

/** Vite pre-transform restricted to this worktree's one pristine core source file. */
export function recordUpdateRetentionPlugin(enabled: boolean) {
  return {
    name: 'teable-record-update-retention',
    enforce: 'pre' as const,
    transform(source: string, id: string) {
      if (!enabled || id.split('?')[0] !== targetFile) return null;
      return { code: instrumentBulkUpdateSource(source).code, map: null };
    },
  };
}
