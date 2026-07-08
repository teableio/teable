import {
  canFreezeColumnCount,
  getMaxFreezeColumnCount,
  MIN_FREEZE_SCROLLABLE_WIDTH,
} from './freeze';

describe('freeze column width limit', () => {
  const createOptions = (
    containerWidth: number,
    columnInitSize: number,
    columnWidths: number[]
  ) => ({
    containerWidth,
    columnInitSize,
    columnCount: columnWidths.length,
    getColumnWidth: (index: number) => columnWidths[index] ?? 0,
  });

  test('allows freeze when the right side keeps minimum scrollable width', () => {
    const options = createOptions(520, 40, [120, 120]);

    expect(canFreezeColumnCount(2, options)).toBe(true);
    expect(520 - (40 + 120 + 120)).toBe(MIN_FREEZE_SCROLLABLE_WIDTH);
  });

  test('returns the maximum freeze count when requested columns exceed the available width', () => {
    expect(
      getMaxFreezeColumnCount({
        ...createOptions(520, 40, [120, 120, 120]),
      })
    ).toBe(2);
  });

  test('returns zero when even the first field would consume the scrollable width', () => {
    expect(
      getMaxFreezeColumnCount({
        ...createOptions(320, 60, [80, 120]),
      })
    ).toBe(0);
  });

  test('restores larger freeze count when the container becomes wider', () => {
    const columnInitSize = 40;
    const columnWidths = [100, 100, 100, 100, 100];

    expect(getMaxFreezeColumnCount(createOptions(580, columnInitSize, columnWidths))).toBe(3);
    expect(getMaxFreezeColumnCount(createOptions(780, columnInitSize, columnWidths))).toBe(5);
  });
});
