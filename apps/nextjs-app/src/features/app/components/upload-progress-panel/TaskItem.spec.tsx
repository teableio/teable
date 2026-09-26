import type { IGlobalUploadTask } from '@teable/sdk/store/use-attachment-upload-store';
import { fireEvent, render, screen } from '@/test-utils';
import { TaskItem } from './TaskItem';

const noop = () => undefined;

const makeTask = (
  name: string,
  type: string,
  overrides: Partial<IGlobalUploadTask> = {}
): IGlobalUploadTask => ({
  id: 'task1',
  cellKey: 'cell1',
  fileName: name,
  file: new File(['x'], name, { type }),
  progress: 100,
  status: 'completed',
  ...overrides,
});

const attachmentItem = (overrides: Record<string, string> = {}) => ({
  id: 'att1',
  name: 'photo.heic',
  mimetype: 'image/heic',
  size: 1,
  token: 'tok',
  path: '',
  presignedUrl: 'https://example.com/photo.heic',
  ...overrides,
});

const renderTask = (task: IGlobalUploadTask) =>
  render(<TaskItem task={task} onCancel={noop} onRemove={noop} onRetry={noop} />);

describe('TaskItem thumbnail', () => {
  beforeAll(() => {
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  it('keeps the file icon when the browser cannot render the completed image', () => {
    renderTask(makeTask('photo.heic', 'image/heic', { attachmentItem: attachmentItem() }));
    // The icon is the default; the <img> stays hidden until it has loaded.
    const img = screen.getByRole('img');
    const box = img.parentElement as HTMLElement;
    expect(img).toHaveClass('hidden');
    expect(box.querySelector('svg')).toBeInTheDocument();

    fireEvent.error(img);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(box.querySelector('svg')).toBeInTheDocument();
  });

  it('swaps the icon for the server thumbnail once it has loaded', () => {
    renderTask(
      makeTask('photo.heic', 'image/heic', {
        attachmentItem: attachmentItem({ lgThumbnailUrl: 'https://example.com/lg.png' }),
      })
    );
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/lg.png');

    fireEvent.load(img);
    expect(img).not.toHaveClass('hidden');
    expect((img.parentElement as HTMLElement).querySelector('svg')).not.toBeInTheDocument();
  });

  it('previews a local image while uploading', () => {
    renderTask(makeTask('photo.png', 'image/png', { status: 'uploading', progress: 40 }));
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:mock');
  });
});
