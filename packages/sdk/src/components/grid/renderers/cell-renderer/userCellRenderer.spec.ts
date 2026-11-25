import { describe, expect, it, vi } from 'vitest';
import { GridInnerIcon } from '../../managers/sprite-manager/sprites';
import type { ICellRenderProps, IUserCell } from './interface';
import { CellType } from './interface';
import { userCellRenderer } from './userCellRenderer';

const theme = {
  fontSizeXS: 12,
  fontSizeSM: 13,
  fontFamily: 'Inter',
  iconSizeSM: 20,
  cellOptionBg: 'option-bg',
  cellOptionTextColor: 'option-text',
  avatarBg: 'avatar-bg',
  avatarTextColor: 'avatar-text',
  appUserChipBg: 'app-chip-bg',
  appUserAvatarBg: 'app-avatar-bg',
  staticWhite: 'white',
} as ICellRenderProps['theme'];

// Records the fill colour of every shape and every piece of text the renderer paints.
const createCtx = () => {
  const fills: string[] = [];
  const texts: string[] = [];
  const state: Record<string | symbol, unknown> = {
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'middle',
    direction: 'ltr',
  };
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'measureText') return (text: string) => ({ width: text.length * 6 });
      if (prop === 'fill') return () => fills.push(String(target.fillStyle));
      if (prop === 'fillText') return (text: string) => texts.push(text);
      return () => undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, texts };
};

const draw = (users: IUserCell['data'], image?: HTMLImageElement) => {
  const { ctx, fills, texts } = createCtx();
  const drawSprite = vi.fn();
  userCellRenderer.draw({ type: CellType.User, data: users, readonly: true }, {
    ctx,
    theme,
    rect: { x: 0, y: 0, width: 300, height: 32 },
    columnIndex: 0,
    rowIndex: 0,
    isActive: false,
    hoverCellPosition: null,
    imageManager: { loadOrGetImage: () => image },
    spriteManager: { drawSprite },
  } as unknown as ICellRenderProps);
  return { fills, texts, drawSprite };
};

describe('userCellRenderer App users', () => {
  it('paints an App user on the blue chip with the App icon instead of an initial', () => {
    const { fills, texts, drawSprite } = draw([{ id: 'apu_1', name: 'Zoe' }]);

    expect(fills).toContain('app-chip-bg');
    expect(fills).toContain('app-avatar-bg');
    expect(fills).not.toContain('option-bg');
    expect(texts.filter(Boolean)).toEqual(['Zoe']);
    expect(drawSprite).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sprite: GridInnerIcon.AppUser,
        colors: ['white', 'app-avatar-bg'],
      })
    );
  });

  it('keeps a Teable member on the grey chip with their initial', () => {
    const { fills, texts, drawSprite } = draw([{ id: 'usr1', name: 'Zoe' }]);

    expect(fills).toContain('option-bg');
    expect(fills).not.toContain('app-chip-bg');
    expect(texts).toEqual(['Zoe', 'Z']);
    expect(drawSprite).not.toHaveBeenCalled();
  });

  it('shows the picture of an App user who has one', () => {
    const { drawSprite } = draw(
      [{ id: 'apu_1', name: 'Zoe', avatarUrl: 'https://img/zoe.png' }],
      {} as HTMLImageElement
    );

    expect(drawSprite).not.toHaveBeenCalled();
  });
});
