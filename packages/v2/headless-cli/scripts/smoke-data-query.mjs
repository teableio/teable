import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ActorId, CreateBaseCommand } from '@teable/v2-core';
import { createHeadlessRuntime } from '@teable/v2-headless-runtime';

const binary = fileURLToPath(new URL('../dist/teable-headless-pglite', import.meta.url));
const cli = fileURLToPath(new URL('../../../../../packages/ai-tools-cli/bin/teable.js', import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), 'teable-data-query-'));
const dataDir = join(workspace, 'db');
const token = randomUUID();
const port = '17865';
const endpoint = `http://127.0.0.1:${port}`;
const cursorSigningKey = randomUUID();

async function provisionBase() {
  const runtime = await createHeadlessRuntime({ backend: { kind: 'pglite', dataDir } });
  try {
    const actorId = ActorId.create('usr_headless')._unsafeUnwrap();
    const command = CreateBaseCommand.create({ name: 'Data Query smoke' })._unsafeUnwrap();
    const result = await runtime.commandBus.execute({ actorId }, command);
    return result._unsafeUnwrap().base.id().toString();
  } finally {
    await runtime.close();
  }
}

function startServer() {
  const child = spawn(binary, [], {
    cwd: workspace,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: port,
      TEABLE_PGLITE_DIR: dataDir,
      TEABLE_HEADLESS_TOKEN: token,
      TEABLE_DATA_QUERY_CURSOR_SIGNING_KEY: cursorSigningKey,
    },
    stdio: 'inherit',
  });
  const exited = new Promise((resolve) => {
    child.once('error', (error) => resolve({ error }));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  return { child, exited };
}

async function stopServer({ child, exited }) {
  child.kill('SIGTERM');
  const forceKill = setTimeout(() => child.kill('SIGKILL'), 15_000);
  try {
    return await exited;
  } finally {
    clearTimeout(forceKill);
  }
}

const headers = { authorization: `Bearer ${token}` };
async function post(path, body, identity = headers) {
  return fetch(endpoint + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...identity },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
}

async function postOk(path, body, status = 200) {
  const response = await post(path, body);
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

async function waitForServer({ exited }) {
  const deadline = Date.now() + 60_000;
  while (true) {
    const ready = await Promise.race([
      exited.then((result) => {
        throw new Error(`PGlite binary exited before readiness: ${JSON.stringify(result)}`);
      }),
      // The child binds to loopback, and readiness carries no credentials.
      // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
      fetch(endpoint + '/ready', { signal: AbortSignal.timeout(1_000) }).then(
        (response) => response.ok,
        () => false
      ),
    ]);
    if (ready) break;
    assert.ok(Date.now() < deadline, 'PGlite binary did not become ready');
    await delay(250);
  }
}

let server;
try {
  const baseId = await provisionBase();
  server = startServer();
  await waitForServer(server);

  const { table } = await postOk(
    '/tables/create',
    {
      baseId,
      name: 'Amounts',
      fields: [
        { id: 'fldCategory', name: 'Category', type: 'singleLineText', isPrimary: true },
        { id: 'fldAmount', name: 'Amount', type: 'number' },
      ],
    },
    201
  );
  await postOk(
    '/tables/createRecords',
    {
      tableId: table.id,
      records: [
        { fields: { fldCategory: 'Included', fldAmount: 5 } },
        { fields: { fldCategory: 'Included', fldAmount: 7 } },
        { fields: { fldCategory: 'Excluded', fldAmount: 99 } },
      ],
    },
    201
  );

  const definition = {
    version: 1,
    tableId: table.id,
    kind: 'aggregate',
    aggregates: [{ fieldId: 'fldAmount', statisticFunc: 'sum', alias: 'total' }],
    parameters: { category: { type: 'string' } },
    filter: {
      fieldId: 'fldCategory',
      operator: 'is',
      value: { type: 'parameter', name: 'category' },
    },
  };
  const { outputs } = await postOk('/api/v2/queries/validate', { definition });
  assert.deepEqual(outputs.map(({ alias }) => alias), ['total']);

  const request = { definition, parameters: { category: 'Included' } };
  for (const identity of [{}, { authorization: 'Bearer wrong' }]) {
    const response = await post('/api/v2/queries/execute', request, {
      ...identity,
      'x-teable-actor': 'usr_headless',
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).ok, false);
  }

  const requestFile = join(workspace, 'query.json');
  await writeFile(requestFile, JSON.stringify(request));
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [cli, 'query', 'execute', '--endpoint', endpoint, '--request', '@' + requestFile],
    { env: { ...process.env, TEABLE_TOKEN: token }, timeout: 20_000 }
  );
  assert.deepEqual(JSON.parse(stdout), { ok: true, data: { rows: [{ total: 12 }] } });
  console.log('PGlite binary validated and executed a parameterized aggregate through the Teable CLI');

  const cursorDefinition = {
    version: 7,
    kind: 'records',
    tableId: table.id,
    select: [{ fieldId: 'fldAmount', alias: 'amount' }],
    sort: [{ fieldId: 'fldAmount', order: 'asc', nulls: 'last' }],
    parameters: { cursor: { type: 'string' } },
    page: { limit: 2, after: { type: 'parameter', name: 'cursor' } },
  };
  const executePath = '/api/v2/queries/execute';
  const firstPage = await postOk(executePath, { definition: cursorDefinition });
  assert.deepEqual(firstPage.rows, [{ amount: 5 }, { amount: 7 }]);
  const { nextCursor } = firstPage.page;
  assert.ok(typeof nextCursor === 'string' && nextCursor.length > 0);

  assert.deepEqual(await stopServer(server), { code: 0, signal: null });
  server = startServer();
  await waitForServer(server);
  const nextPage = await postOk(executePath, {
    definition: cursorDefinition,
    parameters: { cursor: nextCursor },
  });
  assert.deepEqual(nextPage.rows, [{ amount: 99 }]);
  assert.equal(nextPage.page.nextCursor, null);
  console.log('PGlite binary resumed a structured query cursor after restarting');
} finally {
  if (server) await stopServer(server);
  await rm(workspace, { recursive: true, force: true });
}
