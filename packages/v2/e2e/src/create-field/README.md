# Create Field E2E Tests

This directory contains Teable v2 e2e coverage for create-field scenarios.

## Directory structure

```
create-field/
├── README.md
├── button/
│   └── button.spec.ts
├── conditionalLookup/
│   └── cross-base.spec.ts
├── conditionalRollup/
│   ├── conditionalRollup.spec.ts
│   └── cross-base.spec.ts
├── formula/
│   └── formula.spec.ts
├── lookup/
│   ├── cross-base.spec.ts
│   └── lookup.spec.ts
├── rollup/
│   ├── cross-base.spec.ts
│   └── rollup.spec.ts
└── singleLineText/
    └── singleLineText.spec.ts
```

## Conventions

- Organize tests by created field type (one folder per type).
- Keep cross-base behavior in `cross-base.spec.ts` per type.
- Prefer assertions on both:
  - field metadata after creation
  - computed value behavior after `ctx.drainOutbox()`
