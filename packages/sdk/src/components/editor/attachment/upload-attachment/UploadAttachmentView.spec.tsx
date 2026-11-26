import type { IAttachmentItem } from '@teable/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../../../../context/__tests__/createAppContext';
import { UploadAttachmentView } from './UploadAttachmentView';

const mocks = vi.hoisted(() => ({
  copy: vi.fn(),
  toast: { success: vi.fn() },
}));

vi.mock('copy-to-clipboard', () => ({ default: mocks.copy }));
vi.mock('@teable/ui-lib', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sonner: { toast: mocks.toast },
}));

const wrapper = createAppContext();

const attachment = (id: string, name: string): IAttachmentItem => ({
  id,
  name,
  mimetype: 'application/zip',
  size: 1,
  token: id,
  path: '',
  presignedUrl: `https://example.com/${id}`,
});

const PUBLIC_URL = 'https://spc1.teableusercontent.com/files/tbl1/fld1/abc.zip';
const files = [
  { ...attachment('att1', 'one.zip'), publicUrl: PUBLIC_URL },
  attachment('att2', 'two.zip'),
];

const renderView = (showPublicLinks = true) =>
  render(
    <UploadAttachmentView
      attachments={files}
      uploadingFiles={[]}
      onUpload={vi.fn()}
      onChange={vi.fn()}
      showPublicLinks={showPublicLinks}
    />,
    { wrapper }
  );

const itemOf = (index: number) => screen.getAllByRole('listitem')[index];

describe('UploadAttachmentView public links (T8324)', () => {
  beforeAll(() => {
    window.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
  });

  beforeEach(() => vi.clearAllMocks());

  it('copies the public link of a file that has one', () => {
    renderView();
    expect(
      within(itemOf(1)).queryByRole('button', { name: 'Copy public link' })
    ).not.toBeInTheDocument();

    fireEvent.click(within(itemOf(0)).getByRole('button', { name: 'Copy public link' }));
    expect(mocks.copy).toHaveBeenCalledWith(PUBLIC_URL);
    expect(mocks.toast.success).toHaveBeenCalledWith('Public link copied');
  });

  it('offers no public link once the field turns public links off', () => {
    renderView(false);
    expect(screen.queryByRole('button', { name: 'Copy public link' })).not.toBeInTheDocument();
  });
});
