import { renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { useGridIcons } from './use-grid-icons';

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
});
