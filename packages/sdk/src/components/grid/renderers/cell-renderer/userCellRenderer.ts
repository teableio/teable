import type { IRectangle } from '../../interface';
import { drawAvatar, drawRect, drawSingleLineText } from '../base-renderer';
import { CellType } from './interface';
import type { IInternalCellRenderer, ICellRenderProps, IUserCell } from './interface';

const OPTION_RADIUS = 6;
const OPTION_GAP_SIZE = 6;
const OPTION_PADDING_HORIZONTAL = 25;
const SELECT_CELL_PADDING_TOP = 6;

export const userCellRenderer: IInternalCellRenderer<IUserCell> = {
  type: CellType.User,
  needsHover: false,
  needsHoverPosition: false,
  draw: (cell: IUserCell, props: ICellRenderProps) => {
    const { ctx, rect, theme } = props;
    const { data: userSets } = cell;
    const { x: _x, y: _y, width, height } = rect;
    const {
      fontSizeXS,
      fontSizeSM,
      fontFamily,
      iconSizeSM,
      cellHorizontalPadding,
      cellOptionBg,
      cellOptionTextColor,
      avatarBg,
      avatarTextColor,
      avatarSizeMD,
    } = theme;

    const drawArea: IRectangle = {
      x: _x + cellHorizontalPadding,
      y: _y + SELECT_CELL_PADDING_TOP,
      width: width - 2 * cellHorizontalPadding,
      height: height - SELECT_CELL_PADDING_TOP,
    };
    const rows = Math.max(
      1,
      Math.floor((drawArea.height - iconSizeSM) / (iconSizeSM + OPTION_GAP_SIZE)) + 1
    );
    const maxTextWidth = drawArea.width - OPTION_GAP_SIZE * 2;

    ctx.save();
    ctx.beginPath();

    if (userSets.length) {
      ctx.rect(_x, _y, width, height);
      ctx.clip();
    }

    ctx.font = `${fontSizeXS}px ${fontFamily}`;

    let x = drawArea.x;
    let row = 1;
    let y = drawArea.y;

    for (const user of userSets) {
      const text = user.name;

      const { width: displayWidth, text: displayText } = drawSingleLineText(ctx, {
        text,
        fill: cellOptionTextColor,
        maxWidth: maxTextWidth,
        needRender: false,
        fontSize: fontSizeXS,
      });

      const width = displayWidth + OPTION_PADDING_HORIZONTAL + 6;

      if (x !== drawArea.x && x + width > drawArea.x + drawArea.width && row < rows) {
        row++;
        y += iconSizeSM + OPTION_GAP_SIZE;
        x = drawArea.x;
      }

      drawRect(ctx, {
        x,
        y,
        width,
        height: iconSizeSM,
        radius: OPTION_RADIUS,
        fill: cellOptionBg,
      });
      drawSingleLineText(ctx, {
        text: displayText,
        x: x + OPTION_PADDING_HORIZONTAL,
        y: y + 4,
        fill: cellOptionTextColor,
        maxWidth: maxTextWidth,
      });

      drawAvatar(ctx, {
        x: x - 4,
        y: y - 2,
        width: avatarSizeMD,
        height: avatarSizeMD,
        fill: avatarBg,
        stroke: cellOptionBg,
        textColor: avatarTextColor,
        fontSize: fontSizeSM,
        fontFamily,
        user: {
          ...user,
          email: '',
          avatar:
            'https://s1.vika.cn/space/2023/11/15/240eee94276a4afe87c7b7f56cdcbbce?imageView2/1/w/48/h/48/q/100!',
        },
      });

      x += width + 8;
      if (x > drawArea.x + drawArea.width && row >= rows) break;
    }

    ctx.restore();
  },
};
