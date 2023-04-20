import type { CustomCell, Rectangle, CustomRenderer } from '@glideapps/glide-data-grid';
import { measureTextCached, getMiddleCenterBias, GridCellKind } from '@glideapps/glide-data-grid';
import { ColorUtils, FieldType } from '@teable-group/core';
import classNames from 'classnames';
import { roundedRect } from './draw-fns';
import type { ISingleSelectGridCell } from './type';

const tagHeight = 20;
const innerPad = 6;

type SingleSelectCell = CustomCell<ISingleSelectGridCell>;

export const SelectCell: CustomRenderer<SingleSelectCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is SingleSelectCell =>
    (c.data as ISingleSelectGridCell).type === FieldType.SingleSelect,
  draw: (args, cell) => {
    const { ctx, theme, rect } = args;
    const { value } = cell.data;

    const drawArea: Rectangle = {
      x: rect.x + theme.cellHorizontalPadding,
      y: rect.y + theme.cellVerticalPadding,
      width: rect.width - 2 * theme.cellHorizontalPadding,
      height: rect.height - 2 * theme.cellVerticalPadding,
    };
    const rows = Math.max(1, Math.floor(drawArea.height / (tagHeight + innerPad)));

    let x = drawArea.x;
    let row = 1;
    let y = drawArea.y + (drawArea.height - rows * tagHeight - (rows - 1) * innerPad) / 2;
    for (const item of value) {
      ctx.font = `12px ${theme.fontFamily}`;
      const metrics = measureTextCached(item, ctx);
      const width = metrics.width + innerPad * 2;
      const textY = tagHeight / 2;

      if (x !== drawArea.x && x + width > drawArea.x + drawArea.width && row < rows) {
        row++;
        y += tagHeight + innerPad;
        x = drawArea.x;
      }

      // background color
      ctx.fillStyle = theme.bgBubble;
      ctx.beginPath();
      roundedRect(ctx, x, y, width, tagHeight, tagHeight / 2);
      ctx.fill();

      // font text
      ctx.fillStyle = theme.textDark;
      ctx.fillText(
        item,
        x + innerPad,
        y + textY + getMiddleCenterBias(ctx, `12px ${theme.fontFamily}`)
      );

      x += width + 8;
      if (x > drawArea.x + drawArea.width && row >= rows) break;
    }

    return true;
  },
  provideEditor: () => {
    return (cell) => {
      const { onChange, value: cellValue } = cell;
      const { options, value } = cellValue.data;
      const { choices } = options;

      return (
        <div className="mt-2">
          {choices.map(({ name, color }) => {
            const selected = value.includes(name);
            return (
              <label className="flex items-center mb-2" key={name}>
                <input
                  style={{ boxShadow: 'none !important' }}
                  className="focus:shadow-[0_0_0_0_0] cursor-pointer rounded-sm"
                  type="checkbox"
                  checked={selected}
                  onChange={() => {
                    const newValue = selected ? [] : [name];
                    onChange({
                      ...cellValue,
                      data: {
                        ...cellValue.data,
                        value: newValue,
                      },
                    });
                  }}
                />
                <div
                  className={classNames('mx-2 px-2 rounded-lg cursor-pointer', {
                    'opacity-75': !selected,
                  })}
                  style={{
                    backgroundColor: ColorUtils.getHexForColor(color),
                    color: ColorUtils.shouldUseLightTextOnColor(color) ? '#ffffff' : '#000000',
                  }}
                >
                  {name}
                </div>
              </label>
            );
          })}
        </div>
      );
    };
  },
  onPaste: (v, d) => ({
    ...d,
    tags: d.options.choices
      .map((x) => x.name)
      .filter((x) =>
        v
          .split(',')
          .map((s) => s.trim())
          .includes(x)
      ),
  }),
};
