import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mutations, transformMutation } from './computed-mutations.mjs';

const packageDir = fileURLToPath(new URL('../', import.meta.url));
const artifactDir = resolve(
  process.env.COMPUTED_MUTATION_ARTIFACT_DIR ?? `${packageDir}/computed-mutation-artifacts`
);
mkdirSync(artifactDir, { recursive: true });
const results = [];
const summaryPath = resolve(artifactDir, 'summary.json');
const save = () => writeFileSync(summaryPath, JSON.stringify({ results }, null, 2));
const reportTests = (report) => report.modules.flatMap((module) => module.tests);
const intendedTests = (report, mutation) =>
  report.modules
    .filter((module) => module.file === mutation.testFile)
    .flatMap((module) => module.tests)
    .filter((test) => test.name.includes(mutation.testName));

const run = (id) => {
  const testReport = resolve(artifactDir, `${id}.tests.json`);
  const transformReport = resolve(artifactDir, `${id}.transform.json`);
  // Unique report paths prevent a prior interrupted attempt from supplying evidence.
  const attempt = `${Date.now()}-${process.pid}`;
  const freshTestReport = `${testReport}.${attempt}`;
  const freshTransformReport = `${transformReport}.${attempt}`;
  const logPath = resolve(artifactDir, `${id}.log`);
  const log = openSync(logPath, 'w');
  let child;
  try {
    child = spawnSync(
      'pnpm',
      ['exec', 'vitest', 'run', '--config', 'vitest.computed-mutation.config.mjs'],
      {
        cwd: packageDir,
        env: {
          ...process.env,
          COMPUTED_MUTATION: id === 'baseline' ? '' : id,
          COMPUTED_PROFILE_SCOPE: '',
          COMPUTED_MUTATION_TEST_REPORT: freshTestReport,
          COMPUTED_MUTATION_TRANSFORM_REPORT: freshTransformReport,
        },
        stdio: ['ignore', log, log],
        timeout: 20 * 60 * 1000,
      }
    );
  } finally {
    closeSync(log);
  }
  if (child.error || child.signal) {
    throw new Error(
      `${id}: process failed (${child.error?.message ?? child.signal}); see ${logPath}`
    );
  }
  const report = JSON.parse(readFileSync(freshTestReport, 'utf8'));
  writeFileSync(testReport, JSON.stringify(report, null, 2));
  if (
    (report.reason !== 'passed' && report.reason !== 'failed') ||
    report.unhandledErrors.length > 0 ||
    report.modules.length === 0 ||
    report.modules.some((module) => module.errors.length > 0)
  ) {
    throw new Error(
      `${id}: collection, hook, unhandled error or incomplete run; see ${testReport}`
    );
  }
  if (id !== 'baseline') {
    const evidence = JSON.parse(readFileSync(freshTransformReport, 'utf8'));
    const mutation = mutations.find((entry) => entry.id === id);
    if (evidence.id !== id || evidence.file !== mutation.file) {
      throw new Error(`${id}: missing exact source-transform evidence`);
    }
    writeFileSync(transformReport, JSON.stringify(evidence, null, 2));
  }
  return { report, status: child.status };
};

try {
  for (const mutation of mutations) {
    transformMutation(readFileSync(resolve(packageDir, '..', mutation.file), 'utf8'), mutation);
  }
  const baseline = run('baseline');
  if (
    baseline.status !== 0 ||
    baseline.report.reason !== 'passed' ||
    reportTests(baseline.report).some(
      (test) => test.state === 'failed' || test.errors.length > 0
    ) ||
    mutations.some((mutation) => {
      const tests = intendedTests(baseline.report, mutation);
      return tests.length === 0 || tests.some((test) => test.state !== 'passed');
    })
  ) {
    throw new Error('Baseline must pass every intended test before mutation evidence is accepted');
  }
  results.push({ id: 'baseline', status: 'passed' });
  save();

  for (const mutation of mutations) {
    try {
      const { report, status } = run(mutation.id);
      const intended = intendedTests(report, mutation);
      const baselineNames = intendedTests(baseline.report, mutation)
        .map((test) => test.name)
        .sort();
      const actualNames = intended.map((test) => test.name).sort();
      if (
        JSON.stringify(baselineNames) !== JSON.stringify(actualNames) ||
        intended.some((test) => test.state !== 'passed' && test.state !== 'failed')
      ) {
        throw new Error('Mutant did not execute exactly the baseline intended tests');
      }
      const failed = reportTests(report).filter((test) => test.state === 'failed');
      const isIntendedAssertion = (test) =>
        intended.includes(test) &&
        test.errors.length > 0 &&
        test.errors.every(
          (error) =>
            error.name === 'AssertionError' && error.message.includes(mutation.assertionLabel)
        );
      const killed = status === 1 && failed.length > 0 && failed.every(isIntendedAssertion);
      const survived = status === 0 && failed.length === 0 && report.reason === 'passed';
      results.push({
        id: mutation.id,
        status: killed ? 'killed' : survived ? 'survived' : 'invalid',
        failedTests: failed.map((test) => test.name),
        reason:
          killed || survived
            ? undefined
            : 'Failure was not exclusively the intended value assertion',
      });
    } catch (error) {
      results.push({ id: mutation.id, status: 'invalid', reason: error.message });
    }
    save();
  }
} catch (error) {
  results.push({ id: 'gate', status: 'invalid', reason: error.message });
  save();
}

for (const result of results)
  console.log(`${result.id}: ${result.status}${result.reason ? ` — ${result.reason}` : ''}`);
console.log(`Mutation evidence: ${summaryPath}`);
if (
  results.length !== mutations.length + 1 ||
  results.some((result) => result.status !== 'passed' && result.status !== 'killed')
) {
  process.exitCode = 1;
}
