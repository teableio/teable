import { describe, expect, it } from 'vitest';
import { canEditViewLayout } from './viewLayoutEditable';

describe('canEditViewLayout', () => {
  it('allows editing an unlocked view with view|update permission', () => {
    expect(
      canEditViewLayout({
        hasViewUpdatePermission: true,
        isViewLocked: false,
        isPersonalView: false,
      })
    ).toBe(true);
  });

  it('blocks column drag/resize/freeze on a locked view (T2205)', () => {
    expect(
      canEditViewLayout({
        hasViewUpdatePermission: true,
        isViewLocked: true,
        isPersonalView: false,
      })
    ).toBe(false);
  });

  it('keeps a locked view editable in personal mode', () => {
    expect(
      canEditViewLayout({ hasViewUpdatePermission: true, isViewLocked: true, isPersonalView: true })
    ).toBe(true);
  });

  it('blocks editing without view|update permission', () => {
    expect(
      canEditViewLayout({
        hasViewUpdatePermission: false,
        isViewLocked: false,
        isPersonalView: false,
      })
    ).toBe(false);
    expect(
      canEditViewLayout({
        hasViewUpdatePermission: false,
        isViewLocked: false,
        isPersonalView: true,
      })
    ).toBe(false);
  });
});
