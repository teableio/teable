/**
 * Traceability guard: the Teable worklist, this package's requirement ids, and
 * README.md must agree.
 *
 * The review loop is written down in three places and they drifted apart once
 * already:
 *
 * - the Teable worklist is the source of truth (one row per requirement), and
 *   `requirement-case-ids.json` is its snapshot;
 * - the code carries the ids, in `field-requirements` file names, in `[ID]`
 *   prefixes on operation-surface `describe` titles, and in this directory's
 *   tests;
 * - `README.md` maps requirement id → evidence file and records the review
 *   findings.
 *
 * Every assertion here failed on a real mistake made during the review: a cited
 * file that did not exist, a findings table whose numbering had gaps, and an id
 * no test mentioned. They are cheap to check and expensive to notice by hand.
 *
 * The Teable side is checked against the snapshot rather than the live table, so
 * this runs without credentials. Refresh the snapshot with
 * `node scripts/refresh-requirement-case-ids.mjs` (see README.md).
 */
/* eslint-disable @typescript-eslint/naming-convention */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '../..');
const srcRoot = path.join(packageRoot, 'src');

type TraceabilityConfig = {
  requirementIdPattern: string;
  expectedCaseCount: number;
  expectedSectionByGroup: Record<string, string>;
  knownNotAssertable: Record<string, string>;
  readmeReferenceExclusions: Record<string, string>;
  codeSearchGlobs: string[];
  codeSearchExclude: string[];
};

type CaseEntry = {
  caseId: string;
  caseSeq: number;
  localId: string;
  section: string;
  title: string;
};

type CaseIdSnapshot = {
  batch: string;
  artifact: string;
  tableView: string;
  table: string;
  pr: string;
  cases: Record<string, CaseEntry>;
};

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;

const config = readJson<TraceabilityConfig>(path.join(here, 'traceability.config.json'));
const snapshot = readJson<CaseIdSnapshot>(path.join(here, 'requirement-case-ids.json'));
const readme = fs.readFileSync(path.join(here, 'README.md'), 'utf8');

const requirementIds = Object.keys(snapshot.cases).sort();
const idPattern = new RegExp(config.requirementIdPattern);

/** Every file under `src`, as POSIX-style paths relative to it. */
const fileIndex: string[] = [];
const walk = (dir: string) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else fileIndex.push(path.relative(srcRoot, full).split(path.sep).join('/'));
  }
};
walk(srcRoot);

/**
 * Minimal glob: `*` matches within a path segment, `**` across segments. Enough
 * for the reference shapes the README uses, and it fails closed — an unmatched
 * glob is reported rather than skipped.
 */
const globToRegExp = (glob: string): RegExp => {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = escaped
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\0/g, '(?:.*/)?');
  return new RegExp(`^${body}$`);
};

const matchesAnyFile = (glob: string): boolean => {
  const pattern = globToRegExp(glob);
  return fileIndex.some((file) => pattern.test(file));
};

/** Resolves a README token against `src/`, this directory, or as a glob. */
const resolvesInRepo = (token: string): boolean => {
  if (fs.existsSync(path.join(srcRoot, token))) return true;
  if (fs.existsSync(path.join(here, token))) return true;
  if (matchesAnyFile(token)) return true;
  return matchesAnyFile(`field-requirements/${token}`);
};

const stripSrcPrefix = (p: string) => p.replace(/^src\//, '');

const codeContents = fileIndex
  .filter((file) =>
    config.codeSearchGlobs.some((glob) => globToRegExp(stripSrcPrefix(glob)).test(file))
  )
  .filter(
    (file) => !config.codeSearchExclude.some((excluded) => file.endsWith(stripSrcPrefix(excluded)))
  )
  .map((file) => fs.readFileSync(path.join(srcRoot, file), 'utf8'));

const presentInCode = (id: string) => codeContents.some((text) => text.includes(id));

const readmeCoverageIds = [
  ...new Set([...readme.matchAll(/^\|\s*`([A-Z]\d{2})`\s*\|/gm)].map((m) => m[1])),
].sort();

const readmeFindingRows = [
  ...new Set([...readme.matchAll(/^\|\s*(\d+)\s+\| `[A-Z]\d{2}`/gm)].map((m) => Number(m[1]))),
].sort((a, b) => a - b);

const readmeFindingRefs = [
  ...new Set([...readme.matchAll(/see finding (\d+)/g)].map((m) => Number(m[1]))),
].sort((a, b) => a - b);

describe('requirement traceability: worklist snapshot', () => {
  it('holds one entry per requirement', () => {
    expect(requirementIds).toHaveLength(config.expectedCaseCount);
  });

  it('uses well-formed, unique requirement ids', () => {
    expect(requirementIds.filter((id) => !idPattern.test(id))).toEqual([]);
    const localIds = requirementIds.map((id) => snapshot.cases[id].localId);
    expect(new Set(localIds).size).toBe(localIds.length);
  });

  it('assigns a table case id of the shape Y<n>', () => {
    const bad = requirementIds.filter((id) => !/^Y\d+$/.test(snapshot.cases[id].caseId));
    expect(bad.map((id) => `${id}=${snapshot.cases[id].caseId}`)).toEqual([]);
  });

  it('keeps caseSeq consistent with caseId', () => {
    const bad = requirementIds.filter(
      (id) => Number(snapshot.cases[id].caseId.slice(1)) !== snapshot.cases[id].caseSeq
    );
    expect(bad).toEqual([]);
  });

  it('maps every id to the section its group letter promises', () => {
    const bad: string[] = [];
    for (const id of requirementIds) {
      const expected = config.expectedSectionByGroup[id[0]];
      const actual = snapshot.cases[id].section;
      if (actual !== expected) bad.push(`${id}: ${actual} (expected ${expected})`);
    }
    expect(bad).toEqual([]);
  });

  it('gives every entry a usable title', () => {
    const bad = requirementIds.filter((id) => (snapshot.cases[id].title ?? '').length < 4);
    expect(bad).toEqual([]);
  });
});

describe('requirement traceability: README and the snapshot agree', () => {
  it('covers exactly the snapshot ids', () => {
    const onlyInReadme = readmeCoverageIds.filter((id) => !requirementIds.includes(id));
    const onlyInSnapshot = requirementIds.filter((id) => !readmeCoverageIds.includes(id));
    expect({ onlyInReadme, onlyInSnapshot }).toEqual({ onlyInReadme: [], onlyInSnapshot: [] });
  });

  it('has no dangling or unreferenced findings rows', () => {
    const dangling = readmeFindingRefs.filter((n) => !readmeFindingRows.includes(n));
    const unreferenced = readmeFindingRows.filter((n) => !readmeFindingRefs.includes(n));
    expect({ dangling, unreferenced }).toEqual({ dangling: [], unreferenced: [] });
  });

  it('numbers the findings rows without gaps', () => {
    const expected = Array.from({ length: readmeFindingRows.length }, (_, i) => i + 1);
    expect(readmeFindingRows).toEqual(expected);
  });

  it('resolves every .ts reference it makes', () => {
    const tokens = [...new Set([...readme.matchAll(/`([^`]+\.ts)`/g)].map((m) => m[1]))];
    const exclusions = new Set(Object.keys(config.readmeReferenceExclusions));
    const unresolved = tokens.filter((token) => !exclusions.has(token) && !resolvesInRepo(token));
    expect(unresolved).toEqual([]);
  });

  it('explains every reference exclusion', () => {
    const unexplained = Object.entries(config.readmeReferenceExclusions)
      .filter(([, reason]) => !reason || reason.length < 10)
      .map(([token]) => token);
    expect(unexplained).toEqual([]);
  });
});

describe('requirement traceability: every id reaches the code', () => {
  it('scans a non-trivial set of test files', () => {
    // Guards against the globs silently matching nothing.
    expect(codeContents.length).toBeGreaterThan(200);
  });

  it('asserts every requirement except the documented exceptions', () => {
    const allowlisted = new Set(Object.keys(config.knownNotAssertable));
    const unasserted = requirementIds.filter((id) => !allowlisted.has(id) && !presentInCode(id));
    expect(
      unasserted,
      'These ids appear in no test file. Either add a test, or record why in ' +
        `traceability.config.json → knownNotAssertable: ${unasserted.join(', ')}`
    ).toEqual([]);
  });

  it('keeps knownNotAssertable exact, so it cannot go stale', () => {
    // If a listed id becomes assertable, or an unlisted one stops being, these
    // two lists diverge and the check fails.
    const actuallyMissing = requirementIds.filter((id) => !presentInCode(id));
    expect(actuallyMissing).toEqual(Object.keys(config.knownNotAssertable).sort());
  });

  it('explains every knownNotAssertable entry', () => {
    const unexplained = Object.entries(config.knownNotAssertable)
      .filter(([, reason]) => !reason || reason.length < 30)
      .map(([id]) => id);
    expect(unexplained).toEqual([]);
  });

  it('keeps every allowlisted id within the snapshot', () => {
    const stray = Object.keys(config.knownNotAssertable).filter(
      (id) => !requirementIds.includes(id)
    );
    expect(stray).toEqual([]);
  });
});
