import { TemplateReviewStatus, type ITemplateVo } from '@teable/openapi';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  TemplateHostContext,
  type ITemplateSubmissionHost,
} from '@/features/app/components/space/template/host-context';
import { TemplateReviewPanel } from './TemplateSubmissionState';

vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@teable/sdk/hooks', () => ({
  useLanDayjs: () => () => ({ fromNow: () => 'just now', format: () => '2026-11-16' }),
}));
vi.mock('@/features/app/hooks/useIsCloud', () => ({ useIsCloud: () => true }));
vi.mock('@/features/app/hooks/useOrigin', () => ({ useOrigin: () => 'http://localhost' }));

// Published on submit: the version under review is the live one.
const template = (over: Record<string, unknown> = {}) =>
  ({
    id: 'tpl1',
    name: 'Lotus Yoga',
    isPublished: false,
    version: 1,
    snapshot: { baseId: 'bseLive' },
    history: [{ version: 1, publishedTime: '2026-11-16T00:00:00.000Z' }],
    review: {
      snapshotBaseId: 'bseLive',
      status: TemplateReviewStatus.Review,
      checks: [],
      submittedTime: '2026-11-16T00:00:00.000Z',
      submittedBy: 'usrAuthor',
    },
    ...over,
  }) as unknown as ITemplateVo;

const renderPanel = (
  listing: ITemplateVo,
  host: Partial<ITemplateSubmissionHost> = {},
  shareUrl?: string,
  onWithdraw: () => void = () => undefined
) => {
  const submission = { submit: vi.fn(), withdraw: vi.fn(), ...host };
  const wrap = (children: ReactNode) => (
    <TemplateHostContext.Provider value={{ submission }}>{children}</TemplateHostContext.Provider>
  );
  render(
    wrap(
      <TemplateReviewPanel
        template={listing}
        onWithdraw={onWithdraw}
        withdrawing={false}
        shareUrl={shareUrl}
      />
    )
  );
  return submission;
};

describe('TemplateReviewPanel sharing', () => {
  it('offers the link and the share buttons the moment a template is published, listed or not', () => {
    renderPanel(template(), {}, 'http://localhost/s/k3Pq9xYb2');

    expect(screen.getByText('http://localhost/s/k3Pq9xYb2')).toBeInTheDocument();
    expect(screen.getByText('publishBase.shareWith')).toBeInTheDocument();
    expect(screen.getByText('publishBase.review.live')).toBeInTheDocument();
    // how its review goes is not shown: only whether the template centre lists it
    expect(screen.queryByText('publishBase.review.listed')).toBeNull();
    expect(screen.queryByText('publishBase.review.status.review')).toBeNull();
  });

  it('says so once the template centre lists it', () => {
    renderPanel(
      template({ isPublished: true, featured: true, review: null }),
      {},
      'http://localhost/s/k3Pq9xYb2'
    );

    expect(screen.getByText('publishBase.review.live')).toBeInTheDocument();
    expect(screen.getByText('publishBase.review.listed')).toBeInTheDocument();
  });

  it('does not call listed a template published before reviews that the template centre does not show', () => {
    // published long ago: flagged, but neither featured nor let in by a review
    renderPanel(template({ isPublished: true, featured: false, history: null, review: null }));

    expect(screen.getByText('publishBase.review.live')).toBeInTheDocument();
    expect(screen.queryByText('publishBase.review.listed')).toBeNull();
  });

  it('keeps offering a template the template centre left out', () => {
    const listing = template();
    renderPanel(
      { ...listing, review: { ...listing.review!, status: TemplateReviewStatus.Rejected } },
      {},
      'http://localhost/s/k3Pq9xYb2'
    );

    expect(screen.getByText('http://localhost/s/k3Pq9xYb2')).toBeInTheDocument();
  });

  it('falls back to the permalink while the short link is on its way', () => {
    renderPanel(template());

    expect(screen.getByText('http://localhost/t/tpl1')).toBeInTheDocument();
  });

  it('lets the host put its own share actions in place of the buttons', () => {
    const renderShareActions = vi.fn(() => <div>share-card</div>);
    const listing = template();

    renderPanel(listing, { renderShareActions }, 'http://localhost/s/k3Pq9xYb2');

    expect(screen.getByText('share-card')).toBeInTheDocument();
    expect(screen.queryByText('publishBase.shareWith')).toBeNull();
    expect(renderShareActions).toHaveBeenCalledWith({
      template: listing,
      shareUrl: 'http://localhost/s/k3Pq9xYb2',
    });
  });

  it('offers a submission made before publishing went live on submit, while it waits', () => {
    renderPanel(template({ snapshot: null, history: null }));

    expect(screen.getByText('http://localhost/t/tpl1')).toBeInTheDocument();
  });

  it.each([
    ['taken down by its author', { snapshot: null, review: null }],
    [
      'refused before publishing went live on submit',
      { snapshot: null, history: null, review: { status: TemplateReviewStatus.Rejected } },
    ],
  ])('offers nothing for a template %s', (_label, over) => {
    const renderShareActions = vi.fn(() => <div>share-card</div>);
    renderPanel(template(over), { renderShareActions }, 'http://localhost/s/k3Pq9xYb2');

    expect(screen.queryByText('http://localhost/s/k3Pq9xYb2')).toBeNull();
    expect(renderShareActions).not.toHaveBeenCalled();
  });

  it('asks before taking the template down', () => {
    const onWithdraw = vi.fn();
    renderPanel(template(), {}, 'http://localhost/s/k3Pq9xYb2', onWithdraw);

    fireEvent.click(screen.getByRole('button', { name: 'publishBase.review.withdraw' }));
    expect(onWithdraw).not.toHaveBeenCalled();
    expect(screen.getByText('publishBase.review.withdrawConfirmDescription')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'publishBase.review.withdraw' }).at(-1)!);
    expect(onWithdraw).toHaveBeenCalledTimes(1);
  });
});
