# @teable/v2-utils Architecture

## Purpose

- Provide reusable utility helpers that depend on `@teable/v2-core` but stay outside the domain package.
- Keep the package focused on formatting and convenience utilities.

## Folder Map

- `src/printTable.ts`: Render domain tables and raw record payloads into readable ASCII tables.
- `src/index.ts`: Public exports.
