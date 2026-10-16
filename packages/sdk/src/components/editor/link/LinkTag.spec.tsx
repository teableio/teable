import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LinkTag } from './LinkTag';

vi.mock('../../../context/app/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const chipOf = (title: string) => {
  const label = screen.getByText(title);
  const root = label.closest('[role="button"]') as HTMLElement;
  expect(root).not.toBeNull();
  return { label, root };
};

describe('LinkTag', () => {
  it('shows the linked record display value as a compact chip', () => {
    render(<LinkTag id="recApple" title="苹果" onClick={() => {}} onDelete={() => {}} />);

    const { label, root } = chipOf('苹果');
    expect(label.getAttribute('title')).toBe('苹果');
    // Same chip the grid paints for a link cell, not a full-width bordered row.
    expect(label.className).toContain('bg-secondary');
    expect(label.className).toContain('rounded-md');
    expect(label.className).toContain('h-6');
    expect(label.className).toContain('text-[13px]');
    const rootClasses = Array.from(root.classList);
    expect(rootClasses).not.toContain('w-full');
    expect(rootClasses).not.toContain('shadow-sm');
  });

  it('labels an empty linked record title as untitled', () => {
    render(<LinkTag id="recApple" title="" onClick={() => {}} />);

    const label = screen.getByText('common.untitled');
    expect(label.getAttribute('title')).toBe('common.untitled');
  });

  it('opens the linked record when the chip is clicked', () => {
    const onClick = vi.fn();
    render(<LinkTag id="recApple" title="苹果" onClick={onClick} />);

    fireEvent.click(screen.getByText('苹果'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('unlinks the record without opening it', () => {
    const onClick = vi.fn();
    const onDelete = vi.fn();
    render(<LinkTag id="recApple" title="苹果" onClick={onClick} onDelete={onDelete} />);

    const unlink = screen.getByRole('button', { name: 'common.remove' });
    fireEvent.click(unlink);
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('offers no unlink control for a readonly record', () => {
    const onClick = vi.fn();
    render(<LinkTag id="recApple" title="苹果" readonly onClick={onClick} />);

    expect(screen.queryByRole('button', { name: 'common.remove' })).toBeNull();
    fireEvent.click(screen.getByText('苹果'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('opens the linked record on Enter and Space, at the same id as the click', () => {
    const opened: string[] = [];
    render(<LinkTag id="recApple" title="苹果" onClick={() => opened.push('recApple')} />);

    const { root } = chipOf('苹果');
    expect(root.tabIndex).toBe(0);
    root.focus();
    expect(document.activeElement).toBe(root);

    fireEvent.keyDown(root, { key: 'Enter' });
    expect(opened).toEqual(['recApple']);
    fireEvent.keyDown(root, { key: ' ' });
    expect(opened).toEqual(['recApple', 'recApple']);

    fireEvent.keyDown(root, { key: 'a' });
    expect(opened).toEqual(['recApple', 'recApple']);
  });

  it('unlinks from the keyboard without opening the record', () => {
    const onClick = vi.fn();
    const onDelete = vi.fn();
    render(<LinkTag id="recApple" title="苹果" onClick={onClick} onDelete={onDelete} />);

    const unlink = screen.getByRole('button', { name: 'common.remove' });
    expect(unlink.tabIndex).toBe(0);

    fireEvent.keyDown(unlink, { key: 'Enter' });
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.keyDown(unlink, { key: ' ' });
    expect(onDelete).toHaveBeenCalledTimes(2);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not open from the keyboard for a readonly record', () => {
    const onClick = vi.fn();
    render(<LinkTag id="recApple" title="苹果" readonly onClick={onClick} />);

    const { root } = chipOf('苹果');
    fireEvent.keyDown(root, { key: 'Enter' });
    fireEvent.keyDown(root, { key: ' ' });
    expect(onClick).not.toHaveBeenCalled();
  });
});
