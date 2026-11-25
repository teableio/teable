import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CellUser } from './CellUser';

describe('CellUser App users', () => {
  it('puts an App user on a blue tag with the App icon as their avatar', () => {
    const { container } = render(<CellUser value={{ id: 'apu_1', title: 'Zoe' }} />);
    const tag = container.firstElementChild?.firstElementChild as HTMLElement;

    expect(tag.className).toContain('bg-blue-50');
    expect(tag.className).toContain('dark:bg-blue-500/15');
    expect(tag.className).not.toContain('bg-secondary');
    const fallback = tag.querySelector('.bg-blue-600');
    expect(fallback?.querySelector('svg.lucide-app-window-mac')).toBeTruthy();
    expect(tag.textContent).toBe('Zoe');
  });

  it('leaves Teable members on the grey tag with their initial', () => {
    const { container } = render(<CellUser value={[{ id: 'usr1', title: 'Zoe' }]} />);
    const tag = container.firstElementChild?.firstElementChild as HTMLElement;

    expect(tag.className).toContain('bg-secondary');
    expect(tag.className).not.toContain('bg-blue-50');
    expect(tag.querySelector('svg')).toBeNull();
    expect(tag.textContent).toBe('ZZoe');
  });
});
