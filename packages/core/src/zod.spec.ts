import { strictUnionMember, z } from './zod';

describe('strictUnionMember', () => {
  const union = z.union([
    strictUnionMember(z.object({ expression: z.string() })),
    strictUnionMember(
      z.object({
        formatting: z.object({ type: z.string().optional() }).refine((value) => value.type, {
          message: 'formatting requires "type"',
        }),
      })
    ),
    strictUnionMember(z.object({})),
  ]);

  it('narrows to the member whose keys match', () => {
    const result = union.safeParse({ formatting: {} });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]).toMatchObject({
      code: 'custom',
      message: 'formatting requires "type"',
      path: ['formatting'],
    });
  });

  it('still rejects unrecognized keys and accepts valid input', () => {
    expect(strictUnionMember(z.object({})).safeParse({ extra: 1 }).error?.issues[0].code).toBe(
      'unrecognized_keys'
    );
    expect(union.safeParse({ expression: 'sum({values})' })).toEqual({
      success: true,
      data: { expression: 'sum({values})' },
    });
  });
});
