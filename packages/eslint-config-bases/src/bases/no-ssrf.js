/**
 * SSRF guardrail for *server* packages: steers raw outbound HTTP clients toward
 * the ssrf-http wrappers. Do NOT apply to frontend/browser packages — a
 * same-origin `fetch()` there is not SSRF. At `warn` while the existing
 * call-sites migrate; flip to `error` afterwards so raw clients block merge.
 */
module.exports = {
  rules: {
    'no-restricted-imports': [
      'warn',
      {
        paths: [
          {
            name: 'axios',
            message:
              'Use getSafeAxiosAgents() (SSRF-safe httpAgent/httpsAgent). For fixed server-configured internal endpoints, disable the lint line with a justification.',
          },
          {
            name: 'node-fetch',
            message:
              'Use safeFetch (SSRF-safe). For fixed server-configured internal endpoints, disable the lint line with a justification.',
          },
        ],
      },
    ],
    // Matches only bare global `fetch()` — not `obj.fetch()` or `safeFetch()`.
    'no-restricted-syntax': [
      'warn',
      {
        selector: "CallExpression[callee.type='Identifier'][callee.name='fetch']",
        message:
          'Bare fetch() is SSRF-risky. Use safeFetch() (backend) or an injected SSRF-guarded fetch (v2 packages, see createSsrfSafeFetch).',
      },
    ],
  },
  overrides: [
    {
      // Tests exercise raw clients against loopback servers by design.
      files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
      rules: {
        'no-restricted-imports': 'off',
        'no-restricted-syntax': 'off',
      },
    },
  ],
};
