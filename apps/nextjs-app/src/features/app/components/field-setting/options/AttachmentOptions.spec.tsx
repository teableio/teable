import type { IPublicFileStatusVo } from '@teable/openapi';
import { PublicFileAvailability, UsageFeatureLimit } from '@teable/openapi';
import type { ReactElement } from 'react';
import { render, screen, userEvent } from '@/test-utils';
import { AttachmentOptions } from './AttachmentOptions';

const usage = vi.hoisted(() => ({ current: undefined as unknown }));
const setting = vi.hoisted(() => ({
  current: { publicFileEnabled: true, publicFileCreditPerGb: 10 } as Record<string, unknown>,
}));
const base = vi.hoisted(() => ({ current: { v2Status: { useV2: true } } as unknown }));
/** The field as the table has it loaded, saved. */
const saved = vi.hoisted(() => ({ current: undefined as unknown }));
const api = vi.hoisted(() => ({
  getPublicFileStatus: vi.fn(),
  retryPublicFiles: vi.fn(async () => ({ data: { retried: 2 } })),
}));

vi.mock('next-i18next', () => ({
  // options are printed so the counts a text carries can be checked
  useTranslation: () => ({
    t: (key: string, options?: object) => (options ? `${key} ${JSON.stringify(options)}` : key),
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/features/app/hooks/useBaseUsage', () => ({ useBaseUsage: () => usage.current }));
vi.mock('@/features/app/hooks/useSetting', () => ({
  usePublicSettingQuery: () => ({ data: setting.current }),
}));
vi.mock('@/features/app/components/billing/UpgradeWrapper', () => ({
  UpgradeWrapper: ({ children }: { children: (props: { badge: null }) => ReactElement }) =>
    children({ badge: null }),
}));
vi.mock('@teable/sdk/hooks', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTableId: () => 'tbl1',
  useBase: () => base.current,
  useField: () => saved.current,
}));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPublicFileStatus: api.getPublicFileStatus,
  retryPublicFiles: api.retryPublicFiles,
}));

const withPlan = (publicFileEnable: boolean) => {
  usage.current = { limit: { [UsageFeatureLimit.PublicFileEnable]: publicFileEnable } };
};

const savedAs = (isPublic: boolean) => {
  saved.current = {
    id: 'fld1',
    type: 'attachment',
    isLookup: false,
    options: isPublic ? { isPublic: true } : {},
  };
};

const withStatus = (status: Partial<IPublicFileStatusVo>) =>
  api.getPublicFileStatus.mockResolvedValue({
    data: {
      isPublic: true,
      total: 128,
      published: 96,
      pending: 30,
      failed: 2,
      failures: [{ recordId: 'rec1', attachmentId: 'act1', name: 'a.png', error: 'timeout' }],
      ...status,
    },
  });

describe('attachment public links switch (T8324)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saved.current = undefined;
  });

  it('is hidden without usage info and for lookups', () => {
    usage.current = undefined;
    const { rerender } = render(<AttachmentOptions options={{}} />);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();

    withPlan(true);
    rerender(<AttachmentOptions options={{ isPublic: true }} isLookup />);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('is hidden when the deployment does not publish files', () => {
    withPlan(true);
    setting.current = {};
    render(<AttachmentOptions options={{}} fieldId="fld1" />);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(api.getPublicFileStatus).not.toHaveBeenCalled();
    setting.current = { publicFileEnabled: true, publicFileCreditPerGb: 10 };
  });

  it('is locked without the plan unless the field is already public', () => {
    withPlan(false);
    const { rerender } = render(<AttachmentOptions options={{}} />);
    expect(screen.getByRole('switch')).toBeDisabled();

    rerender(<AttachmentOptions options={{ isPublic: true }} />);
    expect(screen.getByRole('switch')).toBeEnabled();
  });

  it('is locked with the reason on a project still on the v1 engine, public or not', async () => {
    withPlan(true);
    withStatus({});
    base.current = { v2Status: { useV2: false, reason: 'feature_not_enabled' } };
    const { rerender } = render(<AttachmentOptions options={{}} />);
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByText('table:field.editor.publicLinks.legacyEngine')).toBeVisible();

    // v1 copies nothing, so a saved public field has no progress to ask for
    savedAs(true);
    rerender(<AttachmentOptions options={{ isPublic: true }} fieldId="fld1" />);
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.queryByText(/publicLinks\.(status|copying)/)).not.toBeInTheDocument();
    expect(api.getPublicFileStatus).not.toHaveBeenCalled();
    base.current = { v2Status: { useV2: true } };
  });

  it('switches at once, the field change confirm being the one question', async () => {
    withPlan(true);
    const onChange = vi.fn();
    const { rerender } = render(<AttachmentOptions options={{}} onChange={onChange} />);
    // served through a Cloudflare beta, so the switch says so
    expect(screen.getByText('common:noun.beta')).toBeVisible();

    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith({ isPublic: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // until it is saved, the draft says what turning it on does; a new field has no files yet
    rerender(<AttachmentOptions options={{ isPublic: true }} onChange={onChange} />);
    expect(screen.getByText('table:field.editor.publicLinks.enableDescription')).toBeVisible();
    expect(screen.getByText('table:field.editor.publicLinks.enableBackground')).toBeVisible();
    expect(screen.getByText('table:field.editor.publicLinks.enableNoRecall')).toBeVisible();
    // the rate the backend charges, not one written into the text
    expect(
      screen.getByText('table:field.editor.publicLinks.enableTraffic {"credit":10}')
    ).toBeVisible();
  });

  it('says what turning an existing field on does, asking nothing for a private field', () => {
    withPlan(true);
    savedAs(false);
    render(<AttachmentOptions options={{ isPublic: true }} fieldId="fld1" />);
    expect(screen.getByText('table:field.editor.publicLinks.enableDescription')).toBeVisible();
    // the saved state comes with the loaded field
    expect(api.getPublicFileStatus).not.toHaveBeenCalled();
  });

  it('says nothing more for a field already public', async () => {
    withPlan(true);
    savedAs(true);
    withStatus({});
    render(<AttachmentOptions options={{ isPublic: true }} fieldId="fld1" />);
    await screen.findByText(/publicLinks\.copying/);
    expect(screen.queryByText(/publicLinks\.enableBackground/)).not.toBeInTheDocument();
    expect(screen.queryByText(/publicLinks\.disableDescription/)).not.toBeInTheDocument();
  });

  it('warns that the links stop working when turned off', async () => {
    withPlan(true);
    savedAs(true);
    withStatus({});
    const onChange = vi.fn();
    const { rerender } = render(
      <AttachmentOptions options={{ isPublic: true }} fieldId="fld1" onChange={onChange} />
    );
    await screen.findByText(/publicLinks\.copying/);

    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith({ isPublic: false });

    rerender(
      <AttachmentOptions options={{ isPublic: false }} fieldId="fld1" onChange={onChange} />
    );
    expect(screen.getByText('table:field.editor.publicLinks.disableDescription')).toBeVisible();
  });

  it('says it is copying, without counts, and retries the failed files', async () => {
    withPlan(true);
    savedAs(true);
    withStatus({});
    const { unmount } = render(<AttachmentOptions options={{ isPublic: true }} fieldId="fld1" />);

    // the counts come from the cell references, which a field duplicated with its values lacks
    expect(await screen.findByText('table:field.editor.publicLinks.copying')).toBeVisible();
    expect(screen.queryByText(/publicLinks\.status/)).not.toBeInTheDocument();
    expect(screen.getByText(/publicLinks\.failed \{"count":2\}/)).toHaveAttribute(
      'title',
      'a.png: timeout'
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'table:field.editor.publicLinks.retry' })
    );
    expect(api.retryPublicFiles).toHaveBeenCalledWith('tbl1', 'fld1');
    unmount();

    withStatus({ pending: 0, failed: 0, failures: [] });
    render(<AttachmentOptions options={{ isPublic: true }} fieldId="fld1" />);
    expect(await screen.findByText('table:field.editor.publicLinks.status')).toBeVisible();
  });

  it('says the links do not open while the space is paused or its plan lapsed', async () => {
    withPlan(true);
    savedAs(true);
    withStatus({ availability: PublicFileAvailability.Paused });
    const { unmount } = render(<AttachmentOptions options={{ isPublic: true }} fieldId="fld1" />);
    expect(await screen.findByText('table:field.editor.publicLinks.paused')).toBeVisible();
    // the links return 404, so nothing reads as public
    expect(screen.queryByText(/publicLinks\.status/)).not.toBeInTheDocument();
    // failures still need a retry once the links are back
    expect(
      screen.getByRole('button', { name: 'table:field.editor.publicLinks.retry' })
    ).toBeVisible();
    unmount();

    withStatus({ availability: PublicFileAvailability.PlanLapsed });
    render(<AttachmentOptions options={{ isPublic: true }} fieldId="fld1" />);
    expect(await screen.findByText('table:field.editor.publicLinks.planLapsed')).toBeVisible();
    // files added since the plan lapsed are not public, so no count or retry claims otherwise
    expect(screen.queryByText(/publicLinks\.status/)).not.toBeInTheDocument();
    expect(screen.queryByText(/publicLinks\.failed/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'table:field.editor.publicLinks.retry' })
    ).not.toBeInTheDocument();
  });

  it('shows no progress for a draft switched on but not saved', () => {
    withPlan(true);
    savedAs(false);
    render(<AttachmentOptions options={{ isPublic: true }} fieldId="fld1" />);
    expect(screen.queryByText(/publicLinks\.(status|copying)/)).not.toBeInTheDocument();
    expect(api.getPublicFileStatus).not.toHaveBeenCalled();
  });
});
