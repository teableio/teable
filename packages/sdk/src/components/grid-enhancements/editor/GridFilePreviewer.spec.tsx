import type { IAttachmentCellValue } from '@teable/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { IFieldInstance, Record as IRecord } from '../../../model';
import { GridFilePreviewer } from './GridFilePreviewer';

const attachment = (id: string, name: string) => ({
  id,
  name,
  mimetype: 'application/zip',
  size: 1,
  token: id,
  path: '',
  presignedUrl: `https://example.com/${id}`,
});

const renderPreviewer = (onChange?: (attachments: IAttachmentCellValue | null) => void) => {
  const attachments = [
    attachment('att1', 'one.zip'),
    attachment('att2', 'two.zip'),
    attachment('att3', 'three.zip'),
  ] as IAttachmentCellValue;
  const record = { getCellValue: () => attachments } as unknown as IRecord;
  const field = { id: 'fld1' } as IFieldInstance;
  return render(
    <GridFilePreviewer activeId="att2" record={record} field={field} onChange={onChange} />
  );
};

describe('GridFilePreviewer', () => {
  beforeAll(() => {
    // happy-dom lacks the layout primitives the thumbnail strip relies on.
    window.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
    Element.prototype.scrollTo ??= () => {};
  });

  it('deletes the current file and keeps the preview on its neighbour', () => {
    const onChange = vi.fn();
    renderPreviewer(onChange);
    expect(screen.getByRole('heading', { name: 'two.zip' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'att1' }),
      expect.objectContaining({ id: 'att3' }),
    ]);
    // The file that took the removed slot is shown next.
    expect(screen.getByRole('heading', { name: 'three.zip' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    // Deleting the last file in the list falls back to the new last file.
    expect(screen.getByRole('heading', { name: 'one.zip' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('offers no delete action for a read-only cell', () => {
    renderPreviewer();
    expect(screen.getByRole('heading', { name: 'two.zip' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});
