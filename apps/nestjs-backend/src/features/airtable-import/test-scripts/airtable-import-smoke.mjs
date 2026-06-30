#!/usr/bin/env node
/**
 * Airtable import smoke test against a LOCAL backend.
 *
 * Signs in, resolves the connected Airtable integration, lists the accessible
 * Airtable bases (copy the templates you want to cover into your account first),
 * imports each one through the real SSE endpoint, and reports per-base status +
 * the degradation issues. Re-runnable for local regression testing.
 *
 * Usage:
 *   node src/features/airtable-import/test-scripts/airtable-import-smoke.mjs [nameFilter] [--keep]
 *   BACKEND=http://localhost:3603/api EMAIL=... PASSWORD=... node src/features/airtable-import/test-scripts/airtable-import-smoke.mjs
 *
 *   nameFilter  case-insensitive substring to limit which bases run (optional)
 *   --keep      do not delete any created base (default: delete clean ones,
 *               keep the ones that failed or reported issues for inspection)
 */
const BACKEND = process.env.BACKEND ?? 'http://localhost:3603/api';
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('Set EMAIL and PASSWORD (a local Teable account) before running.');
  process.exit(1);
}
const args = process.argv.slice(2);
const keepAll = args.includes('--keep');
const deleteAll = args.includes('--delete-all');
const nameFilter = args.find((a) => !a.startsWith('--'))?.toLowerCase();

let cookie = '';
const headers = () => ({ 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) });
const captureCookie = (res) => {
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
};

const post = async (path, body) => {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  captureCookie(res);
  return res;
};
const get = async (path) => {
  const res = await fetch(`${BACKEND}${path}`, { headers: headers() });
  captureCookie(res);
  return res;
};

const signin = async () => {
  const res = await post('/auth/signin', { email: EMAIL, password: PASSWORD });
  if (!res.ok) throw new Error(`signin failed: ${res.status} ${await res.text()}`);
  console.log(`✓ signed in as ${EMAIL}`);
};

const getIntegrationId = async () => {
  const res = await get('/user-integrations?provider=airtable');
  if (!res.ok) throw new Error(`integration list failed: ${res.status} ${await res.text()}`);
  const { integrations = [] } = await res.json();
  const integration = integrations.find((i) => i.hasSecret) ?? integrations[0];
  if (!integration) throw new Error('no connected Airtable integration found');
  console.log(`✓ integration: ${integration.id}`);
  return integration.id;
};

const getSpaceId = async () => {
  if (process.env.SPACE_ID) return process.env.SPACE_ID;
  const res = await get('/space');
  if (!res.ok) throw new Error(`space list failed: ${res.status} ${await res.text()}`);
  const spaces = await res.json();
  if (!spaces.length) throw new Error('no space found');
  console.log(`✓ space: ${spaces[0].id} (${spaces[0].name})`);
  return spaces[0].id;
};

const listBases = async (integrationId) => {
  const res = await post('/base/import-airtable/analyze', { integrationId });
  if (!res.ok) throw new Error(`analyze failed: ${res.status} ${await res.text()}`);
  const { bases = [] } = await res.json();
  return bases;
};

// Reads the SSE import stream to completion, returning the final vo or throwing.
const runImport = async (payload) => {
  const res = await fetch(`${BACKEND}/base/import-airtable/stream`, {
    method: 'POST',
    headers: { ...headers(), Accept: 'text/event-stream' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (!json) continue;
      const event = JSON.parse(json);
      if (event.type === 'done') result = event.data;
      else if (event.type === 'error') throw new Error(event.message);
    }
  }
  if (!result) throw new Error('stream ended without a result');
  return result;
};

const deleteBase = async (baseId) => {
  const res = await fetch(`${BACKEND}/base/${baseId}`, { method: 'DELETE', headers: headers() });
  return res.ok;
};

const main = async () => {
  await signin();
  const [integrationId, spaceId] = [await getIntegrationId(), await getSpaceId()];
  let bases = await listBases(integrationId);
  if (nameFilter) bases = bases.filter((b) => b.name.toLowerCase().includes(nameFilter));
  console.log(
    `\nRunning ${bases.length} base(s)${nameFilter ? ` matching "${nameFilter}"` : ''}:\n`
  );

  const report = [];
  for (const base of bases) {
    const started = Date.now();
    const row = { name: base.name, status: '', tables: 0, issues: 0, kept: '', detail: '' };
    try {
      const vo = await runImport({
        spaceId,
        integrationId,
        airtableBaseId: base.id,
        baseName: `[smoke] ${base.name}`,
        importRecords: true,
        importAttachments: !process.env.NO_ATTACH,
      });
      row.status = '✓ ok';
      row.tables = Object.keys(vo.tableIdMap).length;
      row.issues = vo.issues.length;
      const clean = vo.issues.length === 0;
      if (deleteAll || (!keepAll && clean)) {
        await deleteBase(vo.base.id);
        row.kept = '(deleted)';
      } else {
        row.kept = vo.base.id;
      }
      // surface the distinct issue reasons for quick triage
      const reasons = [...new Set(vo.issues.map((i) => `${i.code}:${i.reason ?? i.toType ?? ''}`))];
      row.detail = reasons.slice(0, 6).join(' | ');
    } catch (e) {
      row.status = '✗ FAIL';
      row.detail = e instanceof Error ? e.message : String(e);
    }
    row.ms = Date.now() - started;
    report.push(row);
    console.log(
      `${row.status.padEnd(7)} ${base.name.padEnd(28)} ${String(row.tables).padStart(2)}t ` +
        `${String(row.issues).padStart(3)} issues ${String(row.ms).padStart(6)}ms  ${row.kept}`
    );
    if (row.detail) console.log(`         ${row.detail}`);
  }

  const failed = report.filter((r) => r.status.includes('FAIL'));
  console.log(
    `\n==== ${report.length} base(s): ${report.length - failed.length} ok, ${failed.length} failed ====`
  );
  if (failed.length) {
    console.log('FAILURES:');
    for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
};

main().catch((e) => {
  console.error('\nFATAL:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
