The openapi method
To keep openapi definitions natural, we add an openapi method to all Zod objects. Its idea is to provide a convenient way to provide OpenApi specific data. It has three overloads:

.openapi({ [key]: value }) - this way we can specify any OpenApi fields. For example z.number().openapi({ example: 3 }) would add example: 3 to the generated schema.
.openapi("<schema-name>") - this way we specify that the underlying zod schema should be "registered" i.e added into components/schemas with the provided <schema-name>
.openapi("<schema-name>", { [key]: value }) - this unites the two use cases above so that we can specify both a registration <schema-name> and additional metadata
For this to work, you need to call extendZodWithOpenApi once in your project.

This should be done only once in a common-entrypoint file of your project (for example an index.ts/app.ts). If you're using tree-shaking with Webpack, mark that file as having side-effects.

It can be bit tricky to achieve this in your codebase, because require is synchronous and import is a async.

Using zod's .meta
Starting from v8 (and zod v4) you can also use zod's .meta to provide metadata and we will read it accordingly.

With zod's new option for generating JSON schemas and maintaining registries we've added a pretty much seamless support for all metadata information coming from .meta calls as if that was metadata passed into .openapi.

So the following 2 schemas produce exactly the same results:

const schema = z
.string()
.openapi('Schema', { description: 'Name of the user', example: 'Test' });

const schema2 = z
.string()
.meta({ id: 'Schema2', description: 'Name of the user', example: 'Test' });
Note: This also means that you unless you are using some of our more complicated scenarios you could even generate a schema without using extendZodWithOpenApi in your codebase and only rely on .meta to provide additional metadata information and schema names (using the id property).
