import type { IUserIntegrationItemVo } from '@teable/openapi';
import { UserIntegrationProvider } from '@teable/openapi';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@/test-utils';
import { ConnectedAccountMenu, connectedAccountLabel } from './ConnectedAccountMenu';

const account = (id: string, email?: string): IUserIntegrationItemVo =>
  ({
    id,
    name: `Google Sheets ${id}`,
    provider: UserIntegrationProvider.GoogleSheet,
    hasSecret: true,
    metadata: email ? { userInfo: { email, name: 'Someone' } } : undefined,
  }) as unknown as IUserIntegrationItemVo;

describe('ConnectedAccountMenu', () => {
  it('names an account by its address, else by its row name', () => {
    expect(connectedAccountLabel(account('a', 'me@acme.com'))).toBe('me@acme.com');
    expect(connectedAccountLabel(account('b'))).toBe('Google Sheets b');
  });

  it('shows the current account and lets the user pick another or connect one more', () => {
    const onChange = vi.fn();
    const onConnectAnother = vi.fn();
    const first = account('a', 'me@acme.com');
    const second = account('b', 'ops@acme.com');
    render(
      <ConnectedAccountMenu
        accounts={[first, second]}
        current={first}
        onChange={onChange}
        onConnectAnother={onConnectAnother}
        label={(name) => `Connected: ${name}`}
      />
    );

    const trigger = screen.getByRole('button', { name: /Connected: me@acme.com/ });
    fireEvent.pointerDown(trigger);
    fireEvent.click(screen.getByText('ops@acme.com'));
    expect(onChange).toHaveBeenCalledWith(second);

    fireEvent.pointerDown(trigger);
    fireEvent.click(screen.getByText('import.connectAnotherAccount'));
    expect(onConnectAnother).toHaveBeenCalled();
  });
});
