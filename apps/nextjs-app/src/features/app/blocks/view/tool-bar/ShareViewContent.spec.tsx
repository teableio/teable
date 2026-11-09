import { ViewType } from '@teable/core';
import type * as SdkHooks from '@teable/sdk/hooks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test-utils';
import { ShareViewContent } from './ShareViewContent';

const tablePermission = vi.hoisted(() => ({ value: {} as Record<string, boolean> }));
const view = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
vi.mock('@teable/sdk/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof SdkHooks>()),
  useView: () => view.value,
  useTablePermission: () => tablePermission.value,
}));
vi.mock('@/features/app/hooks/useShortLink', () => ({
  useShortLink: () => ({ shortUrl: 'https://teable.test/s/viewFixture', isFallback: false }),
}));
vi.mock('./ShareLinkScopeSettings', () => ({ ShareLinkScopeSettings: () => null }));

beforeEach(() => {
  view.value = {
    id: 'viwFixture',
    type: ViewType.Grid,
    enableShare: true,
    shareId: 'shrViewFixture',
    shareMeta: {},
  };
});

describe('ShareViewContent link', () => {
  it('hands the link to a member who manages the share', async () => {
    tablePermission.value = { 'view|share': true, 'view|update': true };
    render(<ShareViewContent />);

    expect(
      await screen.findByDisplayValue('https://teable.test/s/viewFixture')
    ).toBeInTheDocument();
  });

  it('shows anyone else that sharing is on, nothing more', async () => {
    // A member the authority matrix lets update views but not manage shares, whose view data
    // carries neither the share id nor the share settings
    tablePermission.value = { 'view|update': true };
    view.value = { ...view.value, shareId: undefined, shareMeta: undefined };
    render(<ShareViewContent />);

    const toggle = await screen.findByRole('switch', {
      name: 'table:toolbar.others.share.statusLabel',
    });
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    expect(screen.getAllByRole('switch')).toEqual([toggle]);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText('table:baseShare.advanced')).not.toBeInTheDocument();
  });
});
