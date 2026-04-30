import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExpandMarkdownEditor } from './ExpandMarkdownEditor';

const openTextEditor = async () => {
  fireEvent.click(screen.getByTitle('Expand editor'));
  return screen.findByRole('textbox');
};

describe('ExpandMarkdownEditor', () => {
  it('does not submit null when an unchanged blank editor blurs', async () => {
    const onChange = vi.fn();

    render(<ExpandMarkdownEditor value="" initialMode="text" onChange={onChange} />);

    const editor = await openTextEditor();
    fireEvent.blur(editor);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('syncs an external value change while the expanded text editor is clean', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ExpandMarkdownEditor value="" initialMode="text" onChange={onChange} />
    );

    const editor = await openTextEditor();
    expect(editor).toHaveValue('');

    rerender(<ExpandMarkdownEditor value="generated" initialMode="text" onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toHaveValue('generated');
    });

    fireEvent.blur(screen.getByRole('textbox'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('submits null when a non-empty expanded text value is cleared', async () => {
    const onChange = vi.fn();

    render(<ExpandMarkdownEditor value="generated" initialMode="text" onChange={onChange} />);

    const editor = await openTextEditor();
    fireEvent.change(editor, { target: { value: '' } });
    fireEvent.blur(editor);

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('does not remount after its own committed value is reflected by the parent', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ExpandMarkdownEditor value="" initialMode="text" onChange={onChange} />
    );

    const editor = await openTextEditor();
    fireEvent.change(editor, { target: { value: 'manual' } });
    fireEvent.blur(editor);

    expect(onChange).toHaveBeenCalledWith('manual');

    rerender(<ExpandMarkdownEditor value="manual" initialMode="text" onChange={onChange} />);

    expect(screen.getByRole('textbox')).toBe(editor);
  });
});
