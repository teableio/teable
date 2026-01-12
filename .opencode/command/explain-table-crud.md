---
description: Explain table CRUD and analyze computed + SQL
---

You are debugging a table by running Teable v2 DevTools explain commands.

Use the provided id: `$1`.
Use the provided database URL： `$2`.

If a database URL is provided (for example as `$2`), use it for DevTools commands; otherwise assume the default local URL (localhost/.env).
If the table cannot be found, first question whether the database URL or connection is wrong.

0. Determine whether `$1` is a base id or a table id:

   - RUN `pnpm --filter @teable/v2-devtools cli bases get --base-id $1`
   - If the base exists, treat `$1` as a base id.
   - If the base does not exist, treat `$1` as a table id.

   If `$1` is a base id, collect all table ids and execute the remaining steps for each table:

   - RUN `pnpm --filter @teable/v2-devtools cli tables list --base-id $1`
   - Create a per-table plan (one section per table id) and run steps 1-4 for every table.

1. Pre-analyze table structure and references before explain:

   - RUN `pnpm --filter @teable/v2-devtools cli underlying fields --table-id <tableId>`
   - Identify link fields (`type: link`), lookup/rollup/formula dependencies, and any fields with `reference`/relation hints.
   - For link fields, check `options.relationship` in the underlying field output to decide shape:
     - `oneMany`/`manyMany` => array of `{ id }`
     - `oneOne`/`manyOne` => single `{ id }`
   - RUN `pnpm --filter @teable/v2-devtools cli relations --field-id <linkFieldId> --direction both --level 2` for each link field.
   - If a normal field update impacts other tables via relations, list those dependent fields explicitly.

2. Fetch a sample record and candidate fields:

   - RUN `pnpm --filter @teable/v2-devtools cli records list --table-id <tableId> --limit 1 --mode stored`
   - If no records exist, create one, then re-run list:
     - RUN `pnpm --filter @teable/v2-devtools cli mock generate --table-id <tableId> --count 1`
   - RUN `pnpm --filter @teable/v2-devtools cli records get --table-id <tableId> --record-id <recordId>`
   - Use the `records get` output to see the exact JSON shape for link fields; mirror that shape in the update payload.
   - Example (replace with actual link field name and record IDs from `records get`):
     - If link field is array-like (one-many, many-many): `"LinkFieldName": [{"id": "recForeign1"}, {"id": "recForeign2"}]`
     - If link field is single object (one-one, many-one): `"LinkFieldName": {"id": "recForeign1"}`
     - To remove all links, set the link field to `[]` or `null` depending on shape.
   - Pick writable fields for update that include:
     - At least one link field update (based on link field schema + sample record value shape)
     - Any non-link fields that propagate to other tables

3. Explain CRUD commands with analyze enabled:

   - RUN `pnpm --filter @teable/v2-devtools cli explain create --table-id <tableId> --analyze`
   - RUN `pnpm --filter @teable/v2-devtools cli explain update --table-id <tableId> --record-id <recordId> --fields '<json with link updates and dependent fields>' --analyze`
   - RUN `pnpm --filter @teable/v2-devtools cli explain delete --table-id <tableId> --record-ids <recordId> --analyze`

4. Prioritized analysis:
   - First check for any errors in explain outputs (including SQL explain errors).
   - If errors exist: list them clearly, then propose a concrete fix plan.
   - If no errors: inspect `computedImpact` (dependency graph + update steps) and cross-check with `relations` to see if any computed dependencies are missing. If `relations` is empty but `dependencyGraph.edges` shows links, call it out.
   - Finally analyze SQL performance using `sqlExplains` and `complexity` (highlight slow steps, missing indexes, or high-cost patterns).
