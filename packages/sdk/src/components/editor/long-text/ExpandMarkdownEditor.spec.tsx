import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExpandMarkdownEditor } from './ExpandMarkdownEditor';

const openTextEditor = async () => {
  fireEvent.click(screen.getByTitle('Expand editor'));
  return screen.findByRole('textbox');
};

describe('ExpandMarkdownEditor', () => {
  it('does not call onChange when blurred without any edits', async () => {
    const onChange = vi.fn();

    render(<ExpandMarkdownEditor value="existing" initialMode="text" onChange={onChange} />);

    const editor = await openTextEditor();
    fireEvent.blur(editor);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits null when a non-empty value is cleared', async () => {
    const onChange = vi.fn();

    render(<ExpandMarkdownEditor value="existing" initialMode="text" onChange={onChange} />);

    const editor = await openTextEditor();
    fireEvent.change(editor, { target: { value: '' } });
    fireEvent.blur(editor);

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('commits new value when content changes', async () => {
    const onChange = vi.fn();

    render(<ExpandMarkdownEditor value="" initialMode="text" onChange={onChange} />);

    const editor = await openTextEditor();
    fireEvent.change(editor, { target: { value: 'typed content' } });
    fireEvent.blur(editor);

    expect(onChange).toHaveBeenCalledWith('typed content');
  });

  it('does not overwrite user input when external value updates mid-edit', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ExpandMarkdownEditor value="" initialMode="text" onChange={onChange} />
    );

    const editor = await openTextEditor();
    fireEvent.change(editor, { target: { value: 'user typing' } });

    rerender(<ExpandMarkdownEditor value="remote update" initialMode="text" onChange={onChange} />);

    expect(screen.getByRole('textbox')).toHaveValue('user typing');
  });

  it('commits pending edits on unmount when close path skips blur', async () => {
    const onChange = vi.fn();
    const { unmount } = render(
      <ExpandMarkdownEditor value="existing" initialMode="text" onChange={onChange} />
    );

    const editor = await openTextEditor();
    fireEvent.change(editor, { target: { value: 'unsaved edit' } });

    unmount();

    expect(onChange).toHaveBeenCalledWith('unsaved edit');
  });
});
