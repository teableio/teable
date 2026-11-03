import zhSdk from '@teable/common-i18n/src/locales/zh/sdk.json';
import { fireEvent, render, screen } from '@testing-library/react';
import { merge } from 'lodash';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppContext } from '../../context/app/AppContext';
import { defaultLocale } from '../../context/app/i18n';
import { ExpandRecordHeader } from './ExpandRecordHeader';

const zhLocale = merge({}, defaultLocale, zhSdk);

vi.mock('react-use', () => ({
  useMeasure: () => [vi.fn(), { width: 800 }],
}));

vi.mock('../../hooks', () => ({
  useTablePermission: () => ({
    'record|update': true,
    'record|create': true,
    'record|delete': true,
  }),
  useCommentPermission: () => ({ commentReadable: false, commentWritable: false }),
  useIsMobile: () => false,
}));

vi.mock('../../hooks/use-content-dir', () => ({
  useContentDir: () => 'ltr',
}));

vi.mock('../comment/hooks', () => ({
  useRecordCommentCount: () => 0,
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppContext.Provider value={{ locale: zhLocale, lang: 'zh' }}>{children}</AppContext.Provider>
);

const renderHeader = (onAddToChat?: () => void) =>
  render(
    <ExpandRecordHeader
      tableId="tblA"
      recordId="recA"
      onDuplicate={async () => undefined}
      onAddToChat={onAddToChat}
    />,
    { wrapper }
  );

const openMoreMenu = () => {
  fireEvent.pointerDown(screen.getByRole('button', { expanded: false }));
};

describe('ExpandRecordHeader add to chat T7829', () => {
  it('renders 添加到对话 and invokes the same callback', () => {
    const onAddToChat = vi.fn();
    renderHeader(onAddToChat);

    openMoreMenu();
    fireEvent.click(screen.getByText('添加到对话'));

    expect(onAddToChat).toHaveBeenCalledTimes(1);
  });

  it('hides 添加到对话 when chat is disabled', () => {
    renderHeader(undefined);

    openMoreMenu();
    expect(screen.queryByText('添加到对话')).toBeNull();
  });
});
