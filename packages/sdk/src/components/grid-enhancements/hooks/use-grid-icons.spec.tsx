import { renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { PUBLIC_ATTACHMENT_ICON, PUBLIC_ATTACHMENT_OFF_ICON, useGridIcons } from './use-grid-icons';

vi.mock('../../../hooks/use-field-static-getter', () => ({
  useFieldStaticGetter: () => () => ({
    Icon: ({ style }: { style: React.CSSProperties }) => (
      <svg data-testid="field-icon" style={style} />
    ),
  }),
}));

describe('useGridIcons', () => {
  it('registers a calculation activity icon for computed field headers', () => {
    const { result } = renderHook(() => useGridIcons());

    expect(result.current.calculating).toBeTypeOf('function');
    expect(
      result.current.calculating({ fgColor: 'rgb(1, 2, 3)', bgColor: 'transparent' })
    ).toContain('<svg');
  });

  it('registers the header icon of attachment fields with public links on', () => {
    const { result } = renderHook(() => useGridIcons());

    expect(
      result.current[PUBLIC_ATTACHMENT_ICON]({ fgColor: 'rgb(1, 2, 3)', bgColor: 'transparent' })
    ).toContain('<svg');
  });

  it('draws the icon of a field whose links do not open in amber, whatever the theme', () => {
    const { result } = renderHook(() => useGridIcons());

    const svg = result.current[PUBLIC_ATTACHMENT_OFF_ICON]({
      fgColor: 'rgb(1, 2, 3)',
      bgColor: 'transparent',
    });
    expect(svg).toContain('#d97706');
    expect(svg).not.toContain('rgb(1, 2, 3)');
  });
});
