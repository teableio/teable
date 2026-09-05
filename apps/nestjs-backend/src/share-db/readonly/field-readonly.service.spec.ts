import { describe, expect, it, vi } from 'vitest';
vi.mock('@teable/db-main-prisma', () => ({ PrismaService: class {} }));
import { FieldReadonlyServiceAdapter } from './field-readonly.service';

const create = (shareViewId?: string) => {
  const service = new FieldReadonlyServiceAdapter(
    { get: vi.fn((key) => (key === 'shareViewId' ? shareViewId : undefined)) } as never,
    {} as never
  );
  const read = vi.spyOn(service, 'getSnapshotBulk');
  const authorize = vi.spyOn(service, 'authorizeComputedActivityRead').mockResolvedValue(undefined);
  return { service, read, authorize };
};

describe('compute activity field permission', () => {
  it('rejects denied, missing and conditional-read field documents', async () => {
    const { service, read } = create();
    read.mockResolvedValue([
      { id: 'fldDenied', data: { recordRead: false } },
      { id: 'fldConditional', data: { recordRead: true, computedActivityRead: false } },
    ]);
    for (const id of ['fldDenied', 'fldMissing', 'fldConditional']) {
      await expect(service.authorizeComputedActivityDocuments('tblTest', [id])).rejects.toThrow();
    }
    await expect(
      service.authorizeComputedActivityDocuments('tblTest', ['table'])
    ).rejects.toThrow();
  });
  it('checks exact shared-view table before inspecting allowed fields', async () => {
    const { service, read, authorize } = create('shrTest');
    read.mockResolvedValue([{ id: 'fldAllowed', data: { recordRead: true } }]);
    await service.authorizeComputedActivityDocuments('tblTest', ['fldAllowed']);
    expect(authorize).toHaveBeenCalledWith('tblTest');
    authorize.mockRejectedValueOnce(new Error('wrong table'));
    await expect(
      service.authorizeComputedActivityDocuments('tblOther', ['fldAllowed'])
    ).rejects.toThrow('wrong table');
    expect(read).toHaveBeenCalledTimes(1);
  });
});
