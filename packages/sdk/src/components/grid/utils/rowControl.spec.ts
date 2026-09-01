import { describe, expect, it } from 'vitest';
import type { IGridTheme } from '../configs';
import { RowControlType, type IRowControlItem } from '../interface';
import { getCommentCountOffsetX, getRowControlOffsetX } from './rowControl';

const theme = { iconSizeMD: 20, iconSizeXS: 16 } as IGridTheme;
const width = 60;

const control = (type: RowControlType): IRowControlItem => ({ type, icon: type });

describe('getCommentCountOffsetX', () => {
  it('sits in the expand slot when every control is present', () => {
    const rowControls = [
      control(RowControlType.Drag),
      control(RowControlType.Checkbox),
      control(RowControlType.Expand),
    ];

    expect(getCommentCountOffsetX(width, theme, undefined, rowControls)).toBe(
      getRowControlOffsetX(width, theme, undefined, 3, 2)
    );
  });

  it('follows the expand slot when the drag handle is missing, instead of overflowing the row header', () => {
    // no `view|update` (a base share, or a read-only collaborator) drops the drag handle
    const rowControls = [control(RowControlType.Checkbox), control(RowControlType.Expand)];

    const offsetX = getCommentCountOffsetX(width, theme, undefined, rowControls);

    expect(offsetX).toBe(getRowControlOffsetX(width, theme, undefined, 2, 1));
    expect(offsetX).toBeLessThan(width);
    // the previously hardcoded slot index landed past the row header, on the first cell
    expect(getRowControlOffsetX(width, theme, undefined, 2, 2)).toBeGreaterThan(width);
  });

  it('has nowhere to draw without an expand control', () => {
    expect(getCommentCountOffsetX(width, theme, undefined, [])).toBeNull();
    expect(
      getCommentCountOffsetX(width, theme, undefined, [control(RowControlType.Checkbox)])
    ).toBeNull();
  });
});
