import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export { z };

/**
 * `schema.strict()` for use as a union member.
 *
 * Since zod 4.5 an unrecognized key no longer aborts the object it was found in. A union of
 * strict objects then stops narrowing to the one member whose keys match: it reports every member
 * that only failed on keys, and refinements on the enclosing object (where our field-option hints
 * live) no longer run. Marking the key issue as aborting again restores the zod 4.1 narrowing.
 */
export const strictUnionMember = <Shape extends z.core.$ZodShape>(schema: z.ZodObject<Shape>) =>
  schema.strict().check((ctx) => {
    for (const issue of ctx.issues) {
      if (issue.code === 'unrecognized_keys') {
        (issue as { continue?: boolean }).continue = false;
      }
    }
  });
