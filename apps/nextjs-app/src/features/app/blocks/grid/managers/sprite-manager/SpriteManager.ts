import type Konva from 'konva';
import type { IHeaderIconMap, ISpriteProps } from './sprites';
import { sprites } from './sprites';

// eslint-disable-next-line @typescript-eslint/naming-convention
const COLOR_MAP = {
  iconCommonBg: '#737383',
  iconCommonFg: '#009CA6',
  iconSelectedBg: '#FFFFFF',
  iconSelectedFg: '#4F5DFF',
  iconOtherBg: '#4F5DFF',
  iconOtherFg: '#F7F7F8',
};

const getColors = (variant: ISpriteVariant): readonly [string, string] => {
  if (variant === 'normal') {
    return [COLOR_MAP.iconCommonBg, COLOR_MAP.iconCommonFg];
  } else if (variant === 'selected') {
    return [COLOR_MAP.iconSelectedBg, COLOR_MAP.iconSelectedFg];
  } else {
    return [COLOR_MAP.iconOtherBg, COLOR_MAP.iconOtherFg];
  }
};

export type IHeaderIcon = keyof IHeaderIconMap;
export type ISprite = (props: ISpriteProps) => string;
export type ISpriteMap = Record<string | IHeaderIcon, ISprite>;
export type ISpriteVariant = 'normal' | 'selected' | 'special';

interface ISpriteDrawerProps {
  sprite: IHeaderIcon | string;
  variant: ISpriteVariant;
  x: number;
  y: number;
  size: number;
  alpha?: number;
}

export class SpriteManager {
  private spriteMap: Map<string, HTMLCanvasElement> = new Map();
  private headerIcons: ISpriteMap;
  private inFlight = 0;

  constructor(headerIcons?: ISpriteMap, private onSettled?: () => void) {
    this.headerIcons = {
      ...sprites,
      ...headerIcons,
    };
  }

  public drawSprite(ctx: Konva.Context, props: ISpriteDrawerProps) {
    const { sprite, variant, x, y, size, alpha = 1 } = props;
    const [bgColor, fgColor] = getColors(variant);
    const rSize = size * Math.ceil(window.devicePixelRatio);
    const key = `${bgColor}_${fgColor}_${rSize}_${sprite}`;

    let spriteCanvas = this.spriteMap.get(key);
    if (spriteCanvas === undefined) {
      const spriteCb = this.headerIcons[sprite];

      if (spriteCb === undefined) return;

      spriteCanvas = document.createElement('canvas');
      const spriteCtx = spriteCanvas.getContext('2d');

      if (spriteCtx === null) return;

      const imgSource = new Image();
      imgSource.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        spriteCb({ fgColor, bgColor })
      )}`;
      this.spriteMap.set(key, spriteCanvas);
      const promise: Promise<void> | undefined = imgSource.decode();

      if (promise === undefined) return;

      this.inFlight++;
      promise
        .then(() => {
          spriteCtx.drawImage(imgSource, 0, 0, rSize, rSize);
        })
        .finally(() => {
          this.inFlight--;
          if (this.inFlight === 0) {
            this.onSettled?.();
          }
        });
    } else {
      if (alpha < 1) {
        ctx.globalAlpha = alpha;
      }
      ctx.drawImage(spriteCanvas, 0, 0, rSize, rSize, x, y, size, size);
      if (alpha < 1) {
        ctx.globalAlpha = 1;
      }
    }
  }
}

// export const spriteManager = new SpriteManager(getHeaderIcons());
