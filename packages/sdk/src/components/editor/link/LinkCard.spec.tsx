import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LinkCard } from './LinkCard';

vi.mock('../../../context/app/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'common.untitled' ? '无标题' : key),
  }),
}));

vi.mock('../../../hooks/use-content-dir', () => ({
  useContentDir: () => 'ltr',
}));

describe('LinkCard display titles', () => {
  it.each([undefined, ''])('opens a linked record with an empty title (%s)', (title) => {
    const onClick = vi.fn();
    render(<LinkCard title={title} onClick={onClick} />);

    const label = screen.getByText('无标题');
    expect(label.getAttribute('title')).toBe('无标题');
    fireEvent.click(label);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it.each(['Linked item', '0', 'false'])('preserves the display title %s', (title) => {
    render(<LinkCard title={title} />);
    expect(screen.getByText(title).getAttribute('title')).toBe(title);
    expect(screen.queryByText('无标题')).toBeNull();
  });

  it('unlinks without opening the record', () => {
    const onClick = vi.fn();
    const onDelete = vi.fn();
    const { container } = render(<LinkCard onClick={onClick} onDelete={onDelete} />);
    fireEvent.click(container.querySelector('button')!);
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });
});
