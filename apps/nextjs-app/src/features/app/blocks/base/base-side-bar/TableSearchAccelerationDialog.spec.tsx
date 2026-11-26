import { HttpError, Role } from '@teable/core';
import type * as OpenApi from '@teable/openapi';
import { SEARCH_ACCELERATION_LARGE_TABLE_CONFIRMATION_REQUIRED } from '@teable/openapi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, userEvent, waitFor } from '@/test-utils';
import { TableSearchAccelerationDialog } from './TableSearchAccelerationDialog';

const api = vi.hoisted(() => ({
  getTableSearchAccelerationStatus: vi.fn(),
  getTablePermission: vi.fn(),
  setTableSearchAcceleration: vi.fn(),
  getSpaceById: vi.fn(),
}));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenApi>()),
  ...api,
}));
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const largeTableMessage = 'Confirmation is required for tables with 50000 or more records';
const status = (
  intentState: OpenApi.ITableSearchAccelerationStatusVo['intentState'],
  serving = false
) => ({
  data: { tableId: 'tbl1', intentState, serving },
});
const open = () =>
  render(
    <TableSearchAccelerationDialog
      baseId="bse1"
      tableId="tbl1"
      tableName="Orders"
      spaceId="spc1"
      onOpenChange={vi.fn()}
    />
  );

beforeEach(() => {
  vi.resetAllMocks();
  api.getSpaceById.mockResolvedValue({ data: { role: Role.Creator } });
  api.getTablePermission.mockResolvedValue({ data: { table: { 'table|update': true } } });
  api.getTableSearchAccelerationStatus.mockResolvedValue(status('disabled'));
});

describe('table search acceleration settings', () => {
  it.each(['disabled', 'preparing', 'enabled', 'disabling', 'failed'] as const)(
    'renders %s from product intent independently of serving',
    async (state) => {
      api.getTableSearchAccelerationStatus.mockResolvedValue(status(state, true));
      open();
      expect(await screen.findByText(`table:searchAcceleration.state.${state}`)).toBeVisible();
      expect(screen.getByText('table:searchAcceleration.serving')).toBeVisible();
      if (state === 'preparing' || state === 'disabling') {
        expect(screen.queryByText('table:searchAcceleration.enable')).toBeNull();
        expect(screen.queryByText('table:searchAcceleration.disable')).toBeNull();
      }
      expect(api.getTableSearchAccelerationStatus).toHaveBeenCalledWith('bse1', 'tbl1', 'summary');
      expect(api.getTablePermission).toHaveBeenCalledWith('bse1', 'tbl1');
      expect(api.setTableSearchAcceleration).not.toHaveBeenCalled();
    }
  );

  it.each([
    [Role.Owner, false],
    [Role.Editor, true],
    [Role.Viewer, true],
    [undefined, true],
  ] as const)('keeps role %s with table update %s read-only', async (role, canUpdate) => {
    api.getSpaceById.mockResolvedValue({ data: { role } });
    api.getTablePermission.mockResolvedValue({ data: { table: { 'table|update': canUpdate } } });
    open();
    expect(await screen.findByText('table:searchAcceleration.readOnly')).toBeVisible();
    expect(screen.queryByText('table:searchAcceleration.enable')).toBeNull();
    expect(api.setTableSearchAcceleration).not.toHaveBeenCalled();
  });

  it('recovers a failed operation through the supported off transition', async () => {
    api.getTableSearchAccelerationStatus.mockResolvedValueOnce(status('failed'));
    api.getTableSearchAccelerationStatus.mockResolvedValueOnce(status('disabling'));
    api.setTableSearchAcceleration.mockResolvedValue({ data: { intentState: 'disabling' } });
    open();
    await userEvent.click(await screen.findByText('table:searchAcceleration.resetOff'));
    expect(api.setTableSearchAcceleration).toHaveBeenCalledWith('bse1', 'tbl1', { enabled: false });
    expect(await screen.findByText('table:searchAcceleration.state.disabling')).toBeVisible();
    expect(screen.queryByText('table:searchAcceleration.enable')).toBeNull();
    expect(
      await screen.findByText('table:searchAcceleration.enable', {}, { timeout: 7500 })
    ).toBeVisible();
  }, 10_000);

  it.each(['getSpaceById', 'getTablePermission'] as const)(
    'retries a failed %s lookup before showing any write action',
    async (lookup) => {
      api[lookup].mockRejectedValueOnce(new HttpError('Unavailable', 503));
      open();
      expect(await screen.findByText('table:searchAcceleration.permissionError')).toBeVisible();
      expect(screen.queryByText('table:searchAcceleration.enable')).toBeNull();
      await userEvent.click(screen.getByText('common:actions.retry'));
      expect(await screen.findByText('table:searchAcceleration.enable')).toBeVisible();
      expect(api.setTableSearchAcceleration).not.toHaveBeenCalled();
    }
  );

  it('refetches physical status after a successful disable', async () => {
    api.getSpaceById.mockResolvedValue({ data: { role: Role.Owner } });
    api.getTableSearchAccelerationStatus.mockResolvedValueOnce(status('enabled', true));
    api.getTableSearchAccelerationStatus.mockResolvedValue(status('disabling', true));
    api.setTableSearchAcceleration.mockResolvedValue({ data: { intentState: 'disabling' } });
    open();
    await userEvent.click(await screen.findByText('table:searchAcceleration.disable'));
    expect(api.setTableSearchAcceleration).toHaveBeenCalledWith('bse1', 'tbl1', { enabled: false });
    expect(await screen.findByText('table:searchAcceleration.state.disabling')).toBeVisible();
    expect(screen.getByText('table:searchAcceleration.serving')).toBeVisible();
  });

  it('confirms only after the server requires confirmation and the user accepts', async () => {
    api.setTableSearchAcceleration.mockRejectedValue(
      new HttpError('Localized message', 409, {
        reason: SEARCH_ACCELERATION_LARGE_TABLE_CONFIRMATION_REQUIRED,
      })
    );
    open();
    await userEvent.click(await screen.findByText('table:searchAcceleration.enable'));
    expect(await screen.findByText('table:searchAcceleration.confirmDetail')).toBeVisible();
    await userEvent.click(screen.getByText('common:actions.cancel'));
    expect(api.setTableSearchAcceleration).toHaveBeenCalledTimes(1);
    expect(api.setTableSearchAcceleration).toHaveBeenCalledWith('bse1', 'tbl1', { enabled: true });
    await userEvent.click(screen.getByText('table:searchAcceleration.enable'));
    await userEvent.click(await screen.findByText('table:searchAcceleration.confirm'));
    await waitFor(() => expect(api.setTableSearchAcceleration).toHaveBeenCalledTimes(3));
    expect(api.setTableSearchAcceleration).toHaveBeenLastCalledWith('bse1', 'tbl1', {
      enabled: true,
      confirmLargeTable: true,
    });
  });

  it('shows the limit, current usage and additional rows for an over-quota enable', async () => {
    api.setTableSearchAcceleration.mockRejectedValue(
      new HttpError('Payment required', 402, {
        feature: 'searchAcceleration',
        reason: 'quota_exceeded',
        limit: 100000,
        current: 95000,
        increment: 11000,
      })
    );
    open();
    await userEvent.click(await screen.findByText('table:searchAcceleration.enable'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('table:searchAcceleration.quotaExceeded');
    expect(alert).toHaveTextContent(/quotaLimit\s*100,000/);
    expect(alert).toHaveTextContent(/quotaCurrent\s*95,000/);
    expect(alert).toHaveTextContent(/quotaIncrement\s*11,000/);
    expect(api.setTableSearchAcceleration).toHaveBeenCalledTimes(1);
  });

  it('lets the user retry when the switch is temporarily unavailable', async () => {
    api.setTableSearchAcceleration.mockRejectedValueOnce(new HttpError('Unavailable', 503));
    api.setTableSearchAcceleration.mockResolvedValue({ data: { intentState: 'preparing' } });
    open();
    await userEvent.click(await screen.findByText('table:searchAcceleration.enable'));
    expect(await screen.findByText('table:searchAcceleration.unavailable')).toBeVisible();
    expect(api.setTableSearchAcceleration).toHaveBeenCalledTimes(1);
    api.getTableSearchAccelerationStatus.mockResolvedValue(status('preparing'));
    await userEvent.click(screen.getByText('table:searchAcceleration.enable'));
    expect(await screen.findByText('table:searchAcceleration.state.preparing')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.setTableSearchAcceleration).toHaveBeenCalledTimes(2);
  });

  it.each([
    [409, 'Another table maintenance task is in progress'],
    [409, largeTableMessage],
    [403, largeTableMessage],
    [402, 'Payment required'],
  ] as const)('handles other write errors without confirmation (%s)', async (code, message) => {
    api.setTableSearchAcceleration.mockRejectedValue(new HttpError(message, code));
    open();
    await userEvent.click(await screen.findByText('table:searchAcceleration.enable'));
    expect(await screen.findByText('table:searchAcceleration.changeError')).toBeVisible();
    expect(screen.queryByText('table:searchAcceleration.confirm')).toBeNull();
    expect(api.setTableSearchAcceleration).toHaveBeenCalledTimes(1);
  });

  it('retains ordinary search guidance when status fails and offers an explicit retry', async () => {
    api.getTableSearchAccelerationStatus.mockRejectedValueOnce(new HttpError('Unavailable', 503));
    open();
    expect(await screen.findByText('table:searchAcceleration.statusError')).toBeVisible();
    expect(screen.queryByText('table:searchAcceleration.enable')).toBeNull();
    await userEvent.click(screen.getByText('common:actions.retry'));
    expect(await screen.findByText('table:searchAcceleration.notServing')).toBeVisible();
    expect(api.setTableSearchAcceleration).not.toHaveBeenCalled();
  });
});
