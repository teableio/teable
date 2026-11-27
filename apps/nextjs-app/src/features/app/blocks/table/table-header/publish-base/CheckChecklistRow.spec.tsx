import { TemplateCheckResult, TemplateReviewCheck } from '@teable/openapi';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CheckChecklistRow } from './TemplateSubmissionState';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));

const renderRow = (check: Parameters<typeof CheckChecklistRow>[0]['check']) =>
  render(
    <ul>
      <CheckChecklistRow check={check} />
    </ul>
  );

describe('CheckChecklistRow', () => {
  it('names only the unsupported connections', () => {
    renderRow({
      key: TemplateReviewCheck.Connectors,
      result: TemplateCheckResult.Warn,
      providers: ['wecom'],
    } as never);
    expect(screen.getByText(/publishBase\.review\.checkLine\.connectors/)).toHaveTextContent(
      'wecom'
    );
    expect(screen.queryByText(/checkMessage\.connectors/)).toBeNull();
  });

  it('shows the monthly runs, with the full sentence on the help icon', () => {
    renderRow({
      key: TemplateReviewCheck.Estimate,
      result: TemplateCheckResult.Warn,
      runsPerMonth: 2910,
      freeRunsPerMonth: 100,
    } as never);
    expect(screen.getByText(/publishBase\.review\.checkLine\.estimate/)).toHaveTextContent('2910');
    expect(screen.getByRole('button', { name: /checkMessage\.estimate/ })).toBeInTheDocument();
  });
});
