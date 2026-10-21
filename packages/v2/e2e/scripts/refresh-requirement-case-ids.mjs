#!/usr/bin/env node
/**
 * Refresh `src/field-requirements/requirement-case-ids.json` from the Teable
 * requirement worklist.
 *
 * The worklist is the source of truth, so the snapshot in this repo has to be
 * pulled from it rather than hand-edited. Run this after any change to the
 * worklist (a row added, a row reordered, a `用例ID` reissued), then let
 * `traceability.spec.ts` confirm the README and the code still agree.
 *
 *   node scripts/refresh-requirement-case-ids.mjs            # write the file
 *   node scripts/refresh-requirement-case-ids.mjs --check    # fail if it is stale
 *
 * `--check` is what CI-safe automation should call: it exits non-zero when the
 * snapshot and the table disagree, without needing write access.
 *
 * Requires the `teable` CLI, authenticated against the endpoint the worklist
 * lives on. See the "Source of truth" section of
 * `src/field-requirements/README.md` for the tables and the batch marker.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const snapshotPath = path.join(packageRoot, 'src/field-requirements/requirement-case-ids.json');
const configPath = path.join(packageRoot, 'src/field-requirements/traceability.config.json');

const BASE_ID = 'bserJ2pmgiLHFHfXNwE';
const TABLE_ID = 'tblhjrcP0ZgLtKdbkIz';
/** Batch marker stored in the row's 备注; identifies this worklist's rows. */
const BATCH = 'FIELD-REQ-20261012';

const checkOnly = process.argv.includes('--check');

const fail = (message) => {
  console.error(`refresh-requirement-case-ids: ${message}`);
  process.exit(1);
};

const runTeable = (args) => {
  try {
    return execFileSync('teable', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const detail = error.stderr?.trim() || error.message;
    fail(
      `teable CLI call failed (${args.slice(0, 3).join(' ')}…). Is the CLI installed and ` +
        `authenticated against the right endpoint?\n${detail}`
    );
  }
};

// Column names come from the worklist table: 用例ID (formula), 用例标题,
// 所属模块, 执行状态, 备注, 用例序号 (formula), plus the raw record id so the
// generated file can be diffed per row.
const sql = `
  SELECT "__id" AS rid,
         "Dan_Xing_Wen_Ben" AS yid,
         "Yong_Li_Xu_Hao" AS seq,
         "Yong_Li_Biao_Ti" AS title,
         "Bei_Zhu" AS note
  FROM "${BASE_ID}"."${TABLE_ID}"
  WHERE "Bei_Zhu" LIKE '%${BATCH}%'
  ORDER BY "Yong_Li_Xu_Hao"
`;

const raw = runTeable(['sql-query', '--base-id', BASE_ID, '--sql', sql]);
let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  fail(`could not parse the sql-query response as JSON:\n${raw.slice(0, 400)}`);
}

if (!parsed.success) {
  fail(`sql-query reported failure: ${JSON.stringify(parsed.error ?? parsed).slice(0, 400)}`);
}

const rows = parsed.rows ?? [];
if (rows.length === 0) {
  fail(
    `the query returned no rows. Either the batch marker "${BATCH}" changed, or this account ` +
      `cannot read table ${TABLE_ID}.`
  );
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const idPattern = new RegExp(config.requirementIdPattern);
const sectionByGroup = config.expectedSectionByGroup;

const cases = {};
const problems = [];

for (const row of rows) {
  const note = row.note ?? '';
  const match = /FLD-([A-Z0-9]+)/.exec(note);
  if (!match) {
    problems.push(`${row.rid} (${row.yid}) has no \`本地编号：FLD-<id>\` in 备注`);
    continue;
  }
  const requirementId = match[1];
  if (!idPattern.test(requirementId)) {
    problems.push(`${row.rid} (${row.yid}) has a malformed local id FLD-${requirementId}`);
    continue;
  }
  if (cases[requirementId]) {
    problems.push(`${row.rid} (${row.yid}) duplicates FLD-${requirementId}`);
    continue;
  }
  // The row's own 备注 must carry its 用例ID, so the mapping is legible from the
  // table alone even when this snapshot is unavailable.
  if (!note.includes(`用例ID：${row.yid}`)) {
    problems.push(`${row.rid} (${row.yid}) does not record \`用例ID：${row.yid}\` in its 备注`);
  }
  const section = sectionByGroup[requirementId[0]];
  if (!section) problems.push(`no section configured for group "${requirementId[0]}"`);

  cases[requirementId] = {
    caseId: row.yid,
    caseSeq: row.seq,
    localId: `FLD-${requirementId}`,
    section,
    title: row.title,
  };
}

if (problems.length > 0) {
  fail(`the worklist is inconsistent:\n  - ${problems.join('\n  - ')}`);
}

if (Object.keys(cases).length !== config.expectedCaseCount) {
  console.warn(
    `warning: the worklist holds ${Object.keys(cases).length} rows but ` +
      `traceability.config.json expects ${config.expectedCaseCount}. ` +
      `Update expectedCaseCount if the requirement set really changed.`
  );
}

// Canonical order is the document order (§2→§8, F D S C R A B, numeric within a
// group), which is also the order the worklist rows were created in. Sorting
// alphabetically instead would make every `--check` report a false diff.
const groupOrder = Object.keys(sectionByGroup);
const documentOrder = (a, b) => {
  const groupDelta = groupOrder.indexOf(a[0]) - groupOrder.indexOf(b[0]);
  if (groupDelta !== 0) return groupDelta;
  return Number(a.slice(1)) - Number(b.slice(1));
};

const sortedCases = Object.fromEntries(
  Object.keys(cases)
    .sort(documentOrder)
    .map((id) => [id, cases[id]])
);

const previous = fs.existsSync(snapshotPath)
  ? JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
  : {};

const next = {
  $comment:
    'Snapshot of the Teable requirement worklist. The Teable row is authoritative; ' +
    'regenerate with `node scripts/refresh-requirement-case-ids.mjs`.',
  batch: BATCH,
  artifact: previous.artifact,
  tableView: previous.tableView,
  table: TABLE_ID,
  pr: previous.pr,
  cases: sortedCases,
};

const serialised = JSON.stringify(next, null, 2) + '\n';

if (checkOnly) {
  const current = fs.existsSync(snapshotPath) ? fs.readFileSync(snapshotPath, 'utf8') : '';
  const drift = [];
  for (const [id, entry] of Object.entries(sortedCases)) {
    const before = previous.cases?.[id];
    if (!before) drift.push(`added: ${id} → ${entry.caseId}`);
    else if (before.caseId !== entry.caseId) {
      drift.push(`${id}: ${before.caseId} → ${entry.caseId}`);
    }
  }
  for (const id of Object.keys(previous.cases ?? {})) {
    if (!sortedCases[id]) drift.push(`removed: ${id}`);
  }
  if (drift.length > 0 || current !== serialised) {
    const detail =
      drift.length > 0
        ? `${drift.length} row change(s):\n  - ${drift.join('\n  - ')}`
        : 'the row data matches but the file text differs (ordering or formatting)';
    fail(
      `the snapshot is stale — ${detail}\n` +
        'Regenerate it with: node scripts/refresh-requirement-case-ids.mjs'
    );
  }
  console.log(`requirement-case-ids.json is up to date (${Object.keys(sortedCases).length} cases)`);
  process.exit(0);
}

fs.writeFileSync(snapshotPath, serialised);
console.log(
  `wrote ${path.relative(packageRoot, snapshotPath)} with ${Object.keys(sortedCases).length} cases`
);
