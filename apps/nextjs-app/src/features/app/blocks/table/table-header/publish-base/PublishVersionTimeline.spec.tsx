import type { ITemplateVo } from '@teable/openapi';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PublishTimelinePage } from './PublishVersionTimeline';

vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./TemplateSubmissionState', () => ({ TemplateWithdrawButton: () => null }));

const live = { id: 'tplLotus', snapshot: '{}', isPublished: true } as unknown as ITemplateVo;

const renderPage = (liveActionsElsewhere?: boolean) =>
  render(
    <PublishTimelinePage
      header="header"
      loading={false}
      pending={false}
      template={live}
      listing={null}
      listingSummary={{ title: 'Lotus', description: 'Yoga', coverUrl: undefined, complete: true }}
      checks={null}
      guideRow={null}
      changelogField={null}
      termsBar={null}
      publishButton={null}
      reviewPanel={<div>review-panel</div>}
      liveActionsElsewhere={liveActionsElsewhere}
      extra={null}
      previewCard={null}
      contents={null}
    />
  );

describe('PublishTimelinePage', () => {
  it('leaves the live template’s link and actions to a template project’s own place', () => {
    renderPage(true);
    expect(screen.queryByText('review-panel')).toBeNull();
  });

  it('keeps them on the page for a project published before template projects', () => {
    renderPage(false);
    expect(screen.getByText('review-panel')).toBeTruthy();
  });
});
