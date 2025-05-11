import { LRUCache } from 'lru-cache';
import { parseToRGB } from '../../utils';
import type {
  ILineProps,
  IMultiLineTextProps,
  IRectProps,
  IRoundPolyProps,
  ISingleLineTextProps,
  IVector,
  IPoint,
  ICheckboxProps,
  IRingProps,
  IProcessBarProps,
  IChartLineProps,
  IChartBarProps,
  ITextInfo,
  IAvatarProps,
} from './interface';

const singleLineTextInfoCache: LRUCache<string, { text: string; width: number }> = new LRUCache({
  max: 1000,
});

const multiLineTextInfoCache: LRUCache<string, ITextInfo[]> = new LRUCache({ max: 1000 });

// eslint-disable-next-line sonarjs/cognitive-complexity
export const drawMultiLineText = (ctx: CanvasRenderingContext2D, props: IMultiLineTextProps) => {
  const {
    x = 0,
    y = 0,
    text,
    maxWidth,
    maxLines,
    isUnderline,
    fontSize = 13,
    lineHeight = 22,
    fill = 'black',
    textAlign = 'left',
    verticalAlign = 'middle',
    needRender = true,
  } = props;

  let lines: ITextInfo[] = [];
  const ellipsis = '...';
  const ellipsisWidth = ctx.measureText(ellipsis).width;
  let currentLine = '';
  let currentLineWidth = 0;

  const cacheKey = `${text}-${fontSize}-${maxWidth}-${maxLines}`;
  const cachedLines = multiLineTextInfoCache.get(cacheKey);

  if (cachedLines) {
    lines = cachedLines;
  } else {
    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (char === '\n') {
        if (lines.length + 1 === maxLines && i < text.length - 1) {
          lines.push({ text: currentLine + ellipsis, width: currentLineWidth + ellipsisWidth });
          currentLine = '';
          currentLineWidth = 0;
          break;
        }
        lines.push({ text: currentLine, width: currentLineWidth });
        currentLine = '';
        currentLineWidth = 0;
        continue;
      }

      const charWidth = ctx.measureText(char).width;

      if (currentLineWidth + charWidth > maxWidth) {
        if (lines.length < maxLines - 1) {
          lines.push({ text: currentLine, width: currentLineWidth });
          currentLine = char;
          currentLineWidth = charWidth;
        } else {
          if (currentLineWidth + ellipsisWidth > maxWidth) {
            let tempLine = currentLine;
            let tempLineWidth = currentLineWidth;
            while (tempLineWidth + ellipsisWidth > maxWidth) {
              tempLine = tempLine.substring(0, tempLine.length - 1);
              tempLineWidth -= ctx.measureText(tempLine[tempLine.length - 1]).width;
            }
            currentLine = tempLine;
            currentLineWidth = tempLineWidth;
          }
          lines.push({ text: currentLine + ellipsis, width: currentLineWidth + ellipsisWidth });
          break;
        }
      } else {
        currentLine += char;
        currentLineWidth += charWidth;
      }
    }

    if (lines.length < maxLines && currentLine !== '') {
      lines.push({ text: currentLine, width: currentLineWidth });
    }

    multiLineTextInfoCache.set(cacheKey, lines);
  }

  const offsetY = verticalAlign === 'middle' ? fontSize / 2 : 0;

  if (needRender) {
    if (fill) {
      ctx.fillStyle = fill;
      ctx.strokeStyle = fill;
    }
    ctx.textAlign = textAlign;
    ctx.textBaseline = verticalAlign;

    for (let j = 0; j < lines.length; j++) {
      ctx.fillText(lines[j].text, x, y + j * lineHeight + offsetY);
      if (isUnderline) {
        const textWidth = ctx.measureText(lines[j].text).width;
        ctx.beginPath();
        ctx.moveTo(x, y + j * lineHeight + fontSize - 1);
        ctx.lineTo(x + textWidth, y + j * lineHeight + fontSize - 1);
        ctx.stroke();
      }
    }
  }

  return lines;
};

// eslint-disable-next-line sonarjs/cognitive-complexity
export const drawSingleLineText = (ctx: CanvasRenderingContext2D, props: ISingleLineTextProps) => {
  const {
    x = 0,
    y = 0,
    text,
    fill,
    fontSize = 13,
    textAlign = 'left',
    verticalAlign = 'middle',
    maxWidth = Infinity,
    needRender = true,
    isUnderline = false,
  } = props;

  let width = 0;
  let displayText = '';

  const cacheKey = `${text}-${fontSize}-${maxWidth}`;
  const cachedTextInfo = singleLineTextInfoCache.get(cacheKey);

  if (cachedTextInfo) {
    width = cachedTextInfo.width;
    displayText = cachedTextInfo.text;
  } else {
    const ellipsis = '...';
    const ellipsisWidth = ctx.measureText(ellipsis).width;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const charWidth = ctx.measureText(char).width;

      if (width + charWidth > maxWidth) break;

      displayText += char;
      width += charWidth;
    }

    const isDisplayEllipsis = displayText.length < text.length;
    if (isDisplayEllipsis) {
      while (width + ellipsisWidth > maxWidth && displayText.length > 0) {
        displayText = displayText.slice(0, -1);
        width -= ctx.measureText(displayText[displayText.length - 1]).width;
      }
      displayText = ctx.direction === 'rtl' ? ellipsis + displayText : displayText + ellipsis;
      width = Math.min(width + ellipsisWidth, maxWidth);
    } else {
      displayText = text;
    }

    singleLineTextInfoCache.set(cacheKey, { text: displayText, width });
  }

  if (needRender) {
    const offsetY = verticalAlign === 'middle' ? fontSize / 2 : 0;
    const finalX = textAlign === 'right' ? x + maxWidth : x;
    if (fill) {
      ctx.fillStyle = fill;
      ctx.strokeStyle = fill;
    }
    ctx.textAlign = textAlign;
    ctx.textBaseline = verticalAlign;
    ctx.fillText(displayText, finalX, y + offsetY);
    if (isUnderline) {
      ctx.beginPath();
      ctx.moveTo(finalX, y + offsetY + fontSize / 2 - 1);
      ctx.lineTo(finalX + width, y + offsetY + fontSize / 2 - 1);
      ctx.stroke();
    }
  }

  return {
    text: displayText,
    width,
  };
};

export const drawLine = (ctx: CanvasRenderingContext2D, props: ILineProps) => {
  const { x, y, points, stroke, lineWidth = 1, closed = false } = props;
  const length = points.length;

  ctx.save();
  ctx.beginPath();
  if (stroke) ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.translate(x, y);
  ctx.moveTo(points[0], points[1]);

  for (let n = 2; n < length; n += 2) {
    ctx.lineTo(points[n], points[n + 1]);
  }

  if (closed) {
    ctx.closePath();
  }
  ctx.stroke();
  ctx.restore();
};

export const drawRect = (ctx: CanvasRenderingContext2D, props: IRectProps) => {
  const { x, y, width, height, fill, stroke, radius: _radius, opacity } = props;

  ctx.beginPath();
  if (fill) ctx.fillStyle = fill;
  if (stroke) ctx.strokeStyle = stroke;
  if (opacity) ctx.globalAlpha = opacity;

  if (_radius == null) {
    ctx.rect(x, y, width, height);
  } else {
    const radius =
      typeof _radius === 'number'
        ? { tl: _radius, tr: _radius, br: _radius, bl: _radius }
        : {
            tl: Math.min(_radius.tl, height / 2, width / 2),
            tr: Math.min(_radius.tr, height / 2, width / 2),
            bl: Math.min(_radius.bl, height / 2, width / 2),
            br: Math.min(_radius.br, height / 2, width / 2),
          };

    ctx.moveTo(x + radius.tl, y);
    ctx.arcTo(x + width, y, x + width, y + radius.tr, radius.tr);
    ctx.arcTo(x + width, y + height, x + width - radius.br, y + height, radius.br);
    ctx.arcTo(x, y + height, x, y + height - radius.bl, radius.bl);
    ctx.arcTo(x, y, x + radius.tl, y, radius.tl);
  }
  ctx.closePath();

  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
};

// eslint-disable-next-line sonarjs/cognitive-complexity
export const drawRoundPoly = (ctx: CanvasRenderingContext2D, props: IRoundPolyProps) => {
  const { points, radiusAll, fill, stroke } = props;
  const asVec = function (p: IPoint, pp: IPoint): IVector {
    const vx = pp.x - p.x;
    const vy = pp.y - p.y;
    const vlen = Math.sqrt(vx * vx + vy * vy);
    const vnx = vx / vlen;
    const vny = vy / vlen;
    return {
      x: vx,
      y: pp.y - p.y,
      len: vlen,
      nx: vnx,
      ny: vny,
      ang: Math.atan2(vny, vnx),
    };
  };
  let radius: number;
  const len = points.length;
  let p1 = points[len - 1];

  ctx.beginPath();
  if (fill) ctx.fillStyle = fill;
  if (stroke) ctx.strokeStyle = stroke;
  for (let i = 0; i < len; i++) {
    let p2 = points[i % len];
    const p3 = points[(i + 1) % len];

    const v1 = asVec(p2, p1);
    const v2 = asVec(p2, p3);
    const sinA = v1.nx * v2.ny - v1.ny * v2.nx;
    const sinA90 = v1.nx * v2.nx - v1.ny * -v2.ny;
    let angle = Math.asin(sinA < -1 ? -1 : sinA > 1 ? 1 : sinA);
    let radDirection = 1;
    let drawDirection = false;
    if (sinA90 < 0) {
      if (angle < 0) {
        angle = Math.PI + angle;
      } else {
        angle = Math.PI - angle;
        radDirection = -1;
        drawDirection = true;
      }
    } else {
      if (angle > 0) {
        radDirection = -1;
        drawDirection = true;
      }
    }
    radius = p2.radius !== undefined ? p2.radius : radiusAll;

    const halfAngle = angle / 2;

    let lenOut = Math.abs((Math.cos(halfAngle) * radius) / Math.sin(halfAngle));

    let cRadius: number;
    if (lenOut > Math.min(v1.len / 2, v2.len / 2)) {
      lenOut = Math.min(v1.len / 2, v2.len / 2);
      cRadius = Math.abs((lenOut * Math.sin(halfAngle)) / Math.cos(halfAngle));
    } else {
      cRadius = radius;
    }

    let x = p2.x + v2.nx * lenOut;
    let y = p2.y + v2.ny * lenOut;

    x += -v2.ny * cRadius * radDirection;
    y += v2.nx * cRadius * radDirection;

    ctx.arc(
      x,
      y,
      cRadius,
      v1.ang + (Math.PI / 2) * radDirection,
      v2.ang - (Math.PI / 2) * radDirection,
      drawDirection
    );

    p1 = p2;
    p2 = p3;
  }
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
};

export const drawCheckbox = (ctx: CanvasRenderingContext2D, props: ICheckboxProps) => {
  const { x, y, size, radius = 4, fill, stroke, isChecked = false } = props;
  const dynamicSize = isChecked ? size : size - 1;

  ctx.beginPath();
  drawRect(ctx, {
    x,
    y,
    width: dynamicSize,
    height: dynamicSize,
    radius,
    fill,
    stroke,
  });

  if (stroke) ctx.strokeStyle = stroke;
  if (isChecked) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + size / 4.23, y + size / 1.97);
    ctx.lineTo(x + size / 2.42, y + size / 1.44);
    ctx.lineTo(x + size / 1.29, y + size / 3.25);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.9;
    ctx.stroke();
    ctx.restore();
  }
};

export const drawRing = (ctx: CanvasRenderingContext2D, props: IRingProps) => {
  const { x, y, radius, lineWidth = 5, value, maxValue, color } = props;
  const startAngle = -Math.PI / 2;
  const angle = value > maxValue ? 2 * Math.PI : (value / maxValue) * 2 * Math.PI;

  ctx.save();

  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.2;

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(x, y, radius, startAngle, angle + startAngle);
  ctx.stroke();

  ctx.restore();
};

export const drawProcessBar = (ctx: CanvasRenderingContext2D, props: IProcessBarProps) => {
  const { x, y, width, height, radius = 4, value, maxValue, color } = props;
  const progressWidth = value > maxValue ? width : (value / maxValue) * width;

  ctx.save();

  ctx.fillStyle = color;
  ctx.globalAlpha = 0.2;

  ctx.beginPath();
  drawRect(ctx, { x, y, width, height, radius });
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, progressWidth, height);
  ctx.clip();

  ctx.fillStyle = color;
  ctx.globalAlpha = 1;
  drawRect(ctx, { x, y, width, height, radius });
  ctx.fill();
  ctx.restore();

  ctx.restore();
};

export const drawChartLine = (ctx: CanvasRenderingContext2D, props: IChartLineProps) => {
  const {
    x,
    y,
    width,
    height,
    values,
    displayValues = [],
    color,
    axisColor,
    yAxis,
    font,
    hoverX,
    hoverAmount = 0,
  } = props;
  const [minY, maxY] = yAxis ?? [Math.min(...values), Math.max(...values)];
  const delta = maxY - minY === 0 ? 1 : maxY - minY;
  const zeroY = maxY <= 0 ? y : minY >= 0 ? y + height : y + height * (maxY / delta);

  let drawValues = values.map((d) => Math.min(1, Math.max(0, (d - minY) / delta)));

  if (drawValues.length === 1) {
    drawValues = [drawValues[0], drawValues[0]];
  }

  if (minY <= 0 && maxY >= 0) {
    ctx.beginPath();
    ctx.moveTo(x, zeroY);
    ctx.lineTo(x + width, zeroY);

    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;
    ctx.strokeStyle = axisColor;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.beginPath();

  const xStep = width / (drawValues.length - 1);
  const points = drawValues.map((val, index) => {
    return {
      x: x + xStep * index,
      y: y + height - val * height,
    };
  });

  if (points.length > 2) {
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 2; i++) {
      const xControl = (points[i].x + points[i + 1].x) / 2;
      const yControl = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xControl, yControl);
    }
    const curIndex = points.length - 2;
    ctx.quadraticCurveTo(
      points[curIndex].x,
      points[curIndex].y,
      points[curIndex + 1].x,
      points[curIndex + 1].y
    );
  } else {
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 1 + hoverAmount * 0.5;
  ctx.stroke();

  ctx.lineTo(x + width, zeroY);
  ctx.lineTo(x, zeroY);
  ctx.closePath();

  ctx.globalAlpha = 0.2 + 0.2 * hoverAmount;
  const grad = ctx.createLinearGradient(0, y, 0, y + height * 1.4);
  grad.addColorStop(0, color);

  const [r, g, b] = parseToRGB(color);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.globalAlpha = 1;

  if (hoverX != null) {
    ctx.beginPath();
    const closest = Math.min(values.length - 1, Math.max(0, Math.round(hoverX / xStep)));
    ctx.moveTo(x + closest * xStep, y);
    ctx.lineTo(x + closest * xStep, y + height);

    ctx.lineWidth = 1;
    ctx.strokeStyle = axisColor;
    ctx.stroke();

    ctx.save();
    ctx.font = font;
    drawSingleLineText(ctx, {
      x,
      y,
      text: displayValues[closest] ?? values[closest],
      fill: axisColor,
    });
    ctx.restore();
  }
};

// eslint-disable-next-line sonarjs/cognitive-complexity
export const drawChartBar = (ctx: CanvasRenderingContext2D, props: IChartBarProps) => {
  const {
    x,
    y,
    width,
    height,
    values,
    displayValues = [],
    color,
    axisColor,
    yAxis,
    font,
    hoverX,
  } = props;

  const barMaxWidth = 8;
  const [originMinY, maxY] = yAxis ?? [Math.min(...values), Math.max(...values)];
  const minY = originMinY > 0 ? 0 : originMinY;
  const delta = maxY - minY === 0 ? 1 : maxY - minY;
  const zeroY = maxY <= 0 ? y : minY >= 0 ? y + height : y + height * (maxY / delta);

  const drawValues = values.map((d) => Math.min(1, Math.max(0, (d - minY) / delta)));

  if (minY <= 0 && maxY >= 0) {
    ctx.beginPath();
    ctx.moveTo(x, zeroY);
    ctx.lineTo(x + width, zeroY);

    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = axisColor;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.beginPath();
  const margin = 2;
  const spacing = (drawValues.length - 1) * margin;
  const barWidth = Math.min((width - spacing) / drawValues.length, barMaxWidth);

  let drawX = x;
  for (const val of drawValues) {
    let barY = y + height - val * height;
    barY = barY === zeroY ? zeroY - 0.5 : barY;
    ctx.moveTo(drawX, zeroY);
    ctx.lineTo(drawX + barWidth, zeroY);
    ctx.lineTo(drawX + barWidth, barY);
    ctx.lineTo(drawX, barY);

    drawX += barWidth + margin;
  }
  ctx.fillStyle = color;
  ctx.fill();

  if (hoverX != null && hoverX >= 0) {
    ctx.beginPath();
    const xStep = Math.min(width / drawValues.length, barMaxWidth + margin);
    const closest =
      hoverX > drawX - x - margin
        ? null
        : Math.min(drawValues.length - 1, Math.max(0, Math.floor(hoverX / xStep)));

    if (closest == null) return;

    const finalHoverX = x + closest * xStep + (xStep - margin) / 2;
    ctx.moveTo(finalHoverX, y);
    ctx.lineTo(finalHoverX, y + height);

    ctx.lineWidth = 1;
    ctx.strokeStyle = axisColor;
    ctx.stroke();

    ctx.save();
    ctx.font = font;
    drawSingleLineText(ctx, {
      x,
      y,
      text: displayValues[closest] ?? values[closest],
      fill: axisColor,
    });
    ctx.restore();
  }
};

export const drawAvatar = (ctx: CanvasRenderingContext2D, props: IAvatarProps) => {
  const {
    x,
    y,
    width,
    height,
    fill,
    stroke,
    defaultText,
    textColor,
    img,
    fontSize = 10,
    fontFamily,
  } = props;

  ctx.save();
  ctx.beginPath();

  // wrapper stroke
  if (stroke) ctx.strokeStyle = stroke;
  ctx.arc(x + width / 2, y + height / 2, width / 2, 0, Math.PI * 2, false);

  if (fill) ctx.fillStyle = fill;
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();

  if (img) {
    ctx.clip();
    ctx.drawImage(img, x, y, width, height);
    if (stroke) ctx.stroke();
    ctx.restore();
    return;
  }

  const textAbb = defaultText.slice(0, 1);

  ctx.beginPath();
  if (textColor) ctx.fillStyle = textColor;
  ctx.font = `${fontSize}px ${fontFamily}`;

  drawSingleLineText(ctx, {
    x: x + width / 2,
    y: y + height / 2 - fontSize / 2,
    text: textAbb,
    textAlign: 'center',
    fontSize: fontSize,
  });

  if (fill) ctx.fill();
  if (stroke) ctx.stroke();

  ctx.restore();
};
