import { describe, expect, it, vi } from 'vitest';
import { ShareController } from './share.controller';

const createController = (userId?: string) => {
  const shareService = {
    copy: vi.fn().mockResolvedValue({ content: 'v1' }),
    copyV2: vi.fn().mockResolvedValue({ content: 'v2' }),
  };
  const audit = { emitAtomic: vi.fn().mockResolvedValue(undefined) };
  const cls = { get: vi.fn((key: string) => (key === 'user.id' ? userId : undefined)) };
  const controller = new ShareController(
    shareService as never,
    {} as never,
    {} as never,
    {} as never
  );
  Object.assign(controller, { audit, cls });
  return { controller, shareService, audit };
};

const shareInfo = { shareId: 'shr1', tableId: 'tbl1', view: { id: 'viw1' } };

describe('ShareController copy audit', () => {
  it('records an anonymous copy through the v2 path on the share link', async () => {
    const { controller, shareService, audit } = createController();

    await expect(
      controller.copy({ shareInfo, useV2: true }, { ranges: [[0, 0]] } as never)
    ).resolves.toEqual({ content: 'v2' });

    expect(shareService.copyV2).toHaveBeenCalled();
    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'shared.view.copy',
      resourceId: 'shr1',
      userId: 'anonymous',
      params: { shareId: 'shr1', tableId: 'tbl1', viewId: 'viw1' },
    });
  });

  it('attributes a signed-in visitor on the v1 path', async () => {
    const { controller, shareService, audit } = createController('usr1');

    await controller.copy({ shareInfo, useV2: false }, { ranges: [[0, 0]] } as never);

    expect(shareService.copy).toHaveBeenCalled();
    expect(audit.emitAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'shared.view.copy', userId: 'usr1' })
    );
  });

  it('records nothing when the copy is refused', async () => {
    const { controller, shareService, audit } = createController();
    shareService.copy.mockRejectedValue(new Error('not allowed to copy'));

    await expect(
      controller.copy({ shareInfo, useV2: false }, { ranges: [[0, 0]] } as never)
    ).rejects.toThrow('not allowed to copy');
    expect(audit.emitAtomic).not.toHaveBeenCalled();
  });
});
