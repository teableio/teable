import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpandRecordContainerBase } from './ExpandRecordContainerBase';

const router = vi.hoisted(() => ({ query: {} as Record<string, unknown> }));
vi.mock('next/router', () => ({ useRouter: () => router }));

const recorder = vi.hoisted(() => ({ recordId: undefined as string | undefined }));
vi.mock('@teable/sdk', () => ({
  ExpandRecordModel: { Modal: 'modal' },
  ExpandRecorder: ({ recordId }: { recordId?: string }) => {
    recorder.recordId = recordId;
    return null;
  },
}));

const renderFor = (tableId: string) => render(<ExpandRecordContainerBase tableId={tableId} />);

describe('ExpandRecordContainerBase', () => {
  beforeEach(() => {
    recorder.recordId = undefined;
  });

  it("opens the URL's record for the table the URL names", () => {
    router.query = { slug: ['table', 'tblA', 'viwA'], recordId: 'recA' };
    renderFor('tblA');
    expect(recorder.recordId).toBe('recA');
  });

  it('leaves it alone in a table shown beside the one the URL names', () => {
    router.query = { slug: ['table', 'tblA', 'viwA'], recordId: 'recA' };
    renderFor('tblB');
    expect(recorder.recordId).toBeUndefined();
  });

  it('opens it where the URL names no table', () => {
    router.query = { slug: ['chat', 'chtA'], recordId: 'recA' };
    renderFor('tblB');
    expect(recorder.recordId).toBe('recA');
  });
});
