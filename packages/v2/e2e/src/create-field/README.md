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

## Link display defaults

`../createField.e2e.spec.ts` covers the API display-field priority: an explicit
`lookupFieldId` wins; otherwise a field named exactly `Label` wins over the target
table's primary field. Without `Label`, the primary field remains the fallback.
The chosen ID is persisted, not just returned in the creation response.

Empty linked-record display values are presentation-only: the grid label, expanded
record link card, and empty expanded-record heading use the localized `untitled`
placeholder (`无标题` in Simplified Chinese). No placeholder is written to record
data. Expanded link cards remain clickable and support unlinking and selection.

## Grid field visibility across views

`../createFieldViewVisibility.e2e.spec.ts` covers the persisted visibility decision
when another grid view creates a field: a view with no hidden fields shows it,
including after hiding a column and selecting **Show all** (`hidden: false`). A
view with at least one hidden field hides it by default. Existing columns retain
their visibility, and the view creating the field continues to show it.
