import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UserEditorBase } from './EditorBase';

vi.mock('../../../context/app/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('UserEditorBase', () => {
  it('should select first filtered collaborator on Enter for single user (T694)', () => {
    const onChange = vi.fn();
    const collaborators = [
      { userId: 'u1', userName: 'Alice', email: 'alice@example.com' },
      { userId: 'u2', userName: 'Boris', email: 'boris@example.com' },
    ];
    const { rerender } = render(
      <UserEditorBase isMultiple={false} collaborators={collaborators} onChange={onChange} />
    );

    rerender(
      <UserEditorBase isMultiple={false} collaborators={[collaborators[1]]} onChange={onChange} />
    );

    const input = screen.getByPlaceholderText('editor.user.searchPlaceholder');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith({
      id: 'u2',
      title: 'Boris',
      avatarUrl: undefined,
      email: 'boris@example.com',
    });
  });
});
