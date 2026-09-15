import { describe, expect, it } from 'vitest';
import { blendCssColors } from './utils';

const lightHoverOverlay = 'rgba(0,0,0,0.035)';

describe('blendCssColors', () => {
  it('applies light interaction overlays without replacing the base hue', () => {
    expect(blendCssColors('#fff', lightHoverOverlay)).toBe('rgb(246,246,246)');
    expect(blendCssColors('#F7F8FA', lightHoverOverlay)).toBe('rgb(238,239,241)');
    expect(blendCssColors('#FFE8EF', lightHoverOverlay)).toBe('rgb(246,224,231)');
  });

  it('makes selection stronger than hover while retaining semantic color', () => {
    const base = '#E0F7FA';
    expect(blendCssColors(base, lightHoverOverlay)).toBe('rgb(216,238,241)');
    expect(blendCssColors(base, 'rgba(0,0,0,0.075)')).toBe('rgb(207,228,231)');
  });

  it('supports dark-theme overlays and rgba base colors', () => {
    expect(blendCssColors('#121314', 'rgba(255,255,255,0.055)')).toBe('rgb(31,32,33)');
    expect(blendCssColors('#121314', 'rgba(255,255,255,0.11)')).toBe('rgb(44,45,46)');
    expect(blendCssColors('rgba(255,237,213,0.8)', 'rgba(0,0,0,0.075)')).toBe(
      'rgba(236,219,197,0.8)'
    );
  });

  it('leaves unsupported CSS colors unchanged', () => {
    expect(blendCssColors('transparent', lightHoverOverlay)).toBe('transparent');
  });
});
