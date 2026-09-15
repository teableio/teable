# API documentation

Keep display copy beside the route passed to `registerRoute`:

```ts
export const GetExampleRoute: RouteConfig = registerRoute({
  method: "get",
  path: "/base/{baseId}/example",
  tags: ["base"],
  title: "Get project example",
  description: "Retrieve the example associated with a project.",
  request: { params: z.object({ baseId: z.string() }) },
  responses: { 200: { description: "The project example." } },
});
```

`title` and `description` are required by the documentation coverage tests for
Project routes (primary tags `base`, `base node`, and `base-share`). Use
`sidebarTitle` only when the navigation label should differ from the page title.
The shared Swagger generator produces the Mintlify `x-mint.metadata` extension
and the `project`, `project node`, and `project-share` group display names; these
source-only title fields are not emitted as OpenAPI operation fields.
EE routes use the same registration and generation functions.

Keep existing `summary`, `tags`, methods and paths unchanged when editing display
copy. Mintlify derives existing documentation URLs from the primary tag and
summary, or from the method and path when no summary exists. A display title does
not need to match that summary. Regression tests record these existing URL inputs
and allow new routes without requiring another display configuration entry.
Add newly published routes to the URL baseline to protect their URLs from later
changes as well.

After the normal Swagger export/sync to the docs repository, new API titles and
descriptions are included automatically. Do not add per-operation docs overlays
or manually edit generated display extensions in `swagger.json`.
