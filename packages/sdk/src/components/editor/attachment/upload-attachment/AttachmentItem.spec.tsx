import type { IAttachmentItem } from '@teable/core';
import { FilePreviewProvider } from '@teable/ui-lib';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { noop } from 'lodash';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../../../../context/__tests__/createAppContext';
import AttachmentItem from './AttachmentItem';

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

const renderList = (
  attachments: IAttachmentItem[],
  onDelete: (id: string) => void,
  readonly?: boolean
) => (
  <FilePreviewProvider>
    {attachments.map((item) => (
      <AttachmentItem
        key={item.id}
        attachment={item}
        onDelete={onDelete}
        onRename={noop}
        downloadFile={noop}
        readonly={readonly}
      />
    ))}
  </FilePreviewProvider>
);

// The preview trigger is the first button inside each item's card.
const previewTriggerOf = (index: number) =>
  within(screen.getAllByRole('listitem')[index]).getAllByRole('button')[0];

const openPreviewOf = (index: number) => {
  fireEvent.click(previewTriggerOf(index));
};

describe('AttachmentItem preview', () => {
  beforeAll(() => {
    // happy-dom lacks the layout primitives the thumbnail strip relies on.
    window.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
    Element.prototype.scrollTo ??= () => {};
  });

  it('deletes from the preview and keeps the preview on the next file', () => {
    const onDelete = vi.fn();
    const files = [attachment('att1', 'one.zip'), attachment('att2', 'two.zip')];
    const view = render(renderList(files, onDelete), { wrapper });

    openPreviewOf(0);
    expect(screen.getByRole('heading', { name: 'one.zip' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('att1');

    // The host drops the attachment; the preview moves on instead of closing.
    view.rerender(renderList(files.slice(1), onDelete));
    expect(screen.getByRole('heading', { name: 'two.zip' })).toBeInTheDocument();
  });

  it('keeps the file icon when the browser cannot render the image', () => {
    const heic = { ...attachment('att1', 'photo.heic'), mimetype: 'image/heic' };
    render(renderList([heic], noop), { wrapper });
    const tile = previewTriggerOf(0);
    // The icon is the default; the <img> stays hidden until it has loaded.
    const img = within(tile).getByRole('img');
    expect(img).toHaveClass('hidden');
    expect(tile.querySelector('svg')).toBeInTheDocument();

    fireEvent.error(img);
    expect(within(tile).queryByRole('img')).not.toBeInTheDocument();
    expect(tile.querySelector('svg')).toBeInTheDocument();
  });

  it('swaps the icon for the image once it has loaded', () => {
    const png = {
      ...attachment('att1', 'photo.png'),
      mimetype: 'image/png',
      lgThumbnailUrl: 'https://example.com/lg.png',
    };
    render(renderList([png], noop), { wrapper });
    const tile = previewTriggerOf(0);
    const img = within(tile).getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/lg.png');

    fireEvent.load(img);
    expect(img).not.toHaveClass('hidden');
    expect(tile.querySelector('svg')).not.toBeInTheDocument();
  });

  it('offers no delete action when read-only', () => {
    render(renderList([attachment('att1', 'one.zip')], noop, true), { wrapper });

    openPreviewOf(0);
    expect(screen.getByRole('heading', { name: 'one.zip' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});
