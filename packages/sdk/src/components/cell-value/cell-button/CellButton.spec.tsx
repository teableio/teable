import { Colors } from '@teable/core';
import type * as UiLib from '@teable/ui-lib';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getSelectColorPairs } from '../../../utils/select-color';
import { CellButton } from './CellButton';

const theme = vi.hoisted(() => ({ resolvedTheme: 'dark' }));
vi.mock('@teable/ui-lib', async (importOriginal) => ({
  ...(await importOriginal<typeof UiLib>()),
  useTheme: () => theme,
}));

vi.mock('../../../context/app/i18n', () => ({
  useTranslation: () => ({ t: () => 'Clicked count' }),
}));

vi.mock('../../../hooks/use-content-dir', () => ({ useContentDir: () => 'ltr' }));

const options = {
  label: 'Run',
  color: Colors.Teal,
  workflow: { id: 'wflTest', isActive: true },
};

describe('CellButton theme and preview interaction', () => {
  it('renders an unclicked button and follows theme changes without consuming card clicks', () => {
    const onCardClick = vi.fn();
    const { container, getByRole, rerender } = render(<CellButton options={options} />);
    container.addEventListener('click', onCardClick);
    const button = getByRole('button', { name: 'Run' });
    const expected = document.createElement('div');
    expected.style.backgroundColor = getSelectColorPairs(Colors.Teal, 'dark').backgroundColor;
    expected.style.color = getSelectColorPairs(Colors.Teal, 'dark').color;
    expect(button.style.backgroundColor).toBe(expected.style.backgroundColor);
    expect(button.style.color).toBe(expected.style.color);
    fireEvent.click(button);
    expect(onCardClick).toHaveBeenCalledOnce();

    theme.resolvedTheme = 'light';
    rerender(<CellButton options={options} />);
    expected.style.backgroundColor = getSelectColorPairs(Colors.Teal, 'light').backgroundColor;
    expect(getByRole('button').style.backgroundColor).toBe(expected.style.backgroundColor);
  });
});
