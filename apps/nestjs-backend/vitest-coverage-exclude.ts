// Unit specs and their fixtures live next to the sources under src/, which is what `coverage.include`
// matches. Vitest only drops the test files of the current run from the report, so an e2e run would
// otherwise list every unit spec as an untested source file at 0%.
// Keep this list in step with `sonar.test.inclusions`: a file Sonar still counts as a source must
// stay in the report, or Sonar reads its missing LCOV record as uncovered.
export const coverageTestFileExcludes = [
  '**/*.{test,spec}.{js,ts}',
  '**/*.spec-{fixtures,mocks}.ts',
  '**/*.test-{fixture,fixtures}.ts',
];
