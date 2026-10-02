import { writeFileSync } from 'node:fs';

const errorEvidence = (error) => ({
  name: error.name,
  message: error.message,
  stack: error.stack,
});

// Use structured Vitest results: stderr or a nonzero exit alone never kills a mutant.
export default class ComputedMutationReporter {
  onTestRunEnd(modules, unhandledErrors, reason) {
    const reportPath = process.env.COMPUTED_MUTATION_TEST_REPORT;
    if (!reportPath) throw new Error('Mutation test report path is required');
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          reason,
          unhandledErrors: unhandledErrors.map(errorEvidence),
          modules: modules.map((module) => ({
            file: module.relativeModuleId,
            state: module.state(),
            errors: [
              ...module.errors(),
              ...[...module.children.allSuites()].flatMap((suite) => suite.errors()),
            ].map(errorEvidence),
            tests: [...module.children.allTests()].map((test) => {
              const result = test.result();
              return {
                name: test.fullName,
                state: result.state,
                errors: (result.errors ?? []).map(errorEvidence),
              };
            }),
          })),
        },
        null,
        2
      )
    );
  }
}
