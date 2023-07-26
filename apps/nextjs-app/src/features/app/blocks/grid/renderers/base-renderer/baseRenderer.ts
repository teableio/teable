import type {
  ILineProps,
  IMultiLineTextProps,
  IRectProps,
  IRoundPolyProps,
  ISingleLineTextProps,
  IVector,
  IPoint,
  ICheckboxProps,
  ITextProps,
} from './interface';

// eslint-disable-next-line sonarjs/cognitive-complexity
export const drawMultiLineText = (ctx: CanvasRenderingContext2D, props: IMultiLineTextProps) => {
  const {
    x,
    y,
    text,
    fill,
    maxWidth,
    maxLines,
    isUnderline,
    lineHeight = 22,
    textAlign = 'left',
    verticalAlign = 'middle',
  } = props;

  const lines = [];
  let currentLine = '';
  const ellipsis = '...';
  const ellipsisWidth = ctx.measureText(ellipsis).width;
  let currentLineWidth = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '\n') {
      lines.push(currentLine);
      currentLine = '';
      currentLineWidth = 0;
      if (lines.length === maxLines) {
        break;
      }
      continue;
    }

    const charWidth = ctx.measureText(char).width;

    if (currentLineWidth + charWidth > maxWidth) {
      if (lines.length < maxLines - 1) {
        lines.push(currentLine);
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
        lines.push(currentLine + ellipsis);
        break;
      }
    } else {
      currentLine += char;
      currentLineWidth += charWidth;
    }
  }

  if (lines.length < maxLines && currentLine !== '') {
    lines.push(currentLine);
  }

  const offsetY = 0;

  if (fill) ctx.fillStyle = fill;
  ctx.textAlign = textAlign;
  ctx.textBaseline = verticalAlign;

  for (let j = 0; j < lines.length; j++) {
    ctx.fillText(lines[j], x, y + j * lineHeight + offsetY);
    if (isUnderline) {
      const textWidth = ctx.measureText(lines[j]).width;
      ctx.beginPath();
      ctx.moveTo(x, y + j * lineHeight + 2);
      ctx.lineTo(x + textWidth, y + j * lineHeight + 2);
      ctx.stroke();
    }
  }
};

export const drawSingleLineText = (ctx: CanvasRenderingContext2D, props: ISingleLineTextProps) => {
  const {
    x,
    y,
    text,
    fill,
    textAlign = 'left',
    verticalAlign = 'top',
    maxWidth = Infinity,
    needRender = true,
  } = props;
  let width = 0;
  let displayText = '';
  const ellipsis = '...';
  const ellipsisWidth = ctx.measureText(ellipsis).width;

  for (let i = 0; i < text.length; i++) {
    displayText = text.substring(0, i + 1);
    const char = text[i];
    const charWidth = ctx.measureText(char).width;
    width += charWidth;

    if (width + ellipsisWidth > maxWidth) break;
  }

  const isDisplayEllipsis = width + ellipsisWidth > maxWidth;
  displayText = isDisplayEllipsis ? displayText.slice(0, -1) + ellipsis : text;
  width = isDisplayEllipsis ? maxWidth : width;

  if (needRender) {
    if (fill) ctx.fillStyle = fill;
    ctx.textAlign = textAlign;
    ctx.textBaseline = verticalAlign;
    ctx.fillText(displayText, x, y);
  }

  return {
    text: displayText,
    width,
  };
};

export const drawText = (ctx: CanvasRenderingContext2D, props: ITextProps) => {
  const { x, y, text, fill, textAlign = 'left', verticalAlign = 'top' } = props;

  ctx.textAlign = textAlign;
  ctx.textBaseline = verticalAlign;
  if (fill) ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
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
  const { x, y, width, height, fill, stroke, radius: _radius } = props;

  ctx.beginPath();
  if (fill) ctx.fillStyle = fill;
  if (stroke) ctx.strokeStyle = stroke;

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

let metricsSize = 0;
let metricsCache: Record<string, TextMetrics | undefined> = {};

const makeCacheKey = (ctx: CanvasRenderingContext2D, text: string, font?: string) => {
  return `${text}_${font ?? ctx.font}`;
};

export const measureTextCached = (
  ctx: CanvasRenderingContext2D,
  text: string,
  font?: string
): TextMetrics => {
  const key = makeCacheKey(ctx, text, font);
  let metrics = metricsCache[key];

  if (metrics === undefined) {
    metrics = ctx.measureText(text);
    metricsCache[key] = metrics;
    metricsSize++;
  }
  if (metricsSize > 10000) {
    metricsCache = {};
    metricsSize = 0;
  }

  return metrics;
};

const canUseDOM = !!(
  typeof window !== 'undefined' &&
  window.document &&
  window.document.createElement
);

export const bufferContext = () => {
  const canvas = canUseDOM && <HTMLCanvasElement>document.createElement('canvas');
  return canvas ? canvas.getContext('2d') : null;
};

export const bufferCtx = bufferContext();
