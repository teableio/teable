import type { IDatetimeFormatting, INumberFormatting } from '@teable/core';
import { render, screen } from '@/test-utils';
import { NumberFormatting } from './NumberFormatting';

describe('NumberFormatting', () => {
  it('falls back to default number formatting when given a mismatched (datetime) formatting object', () => {
    // Regression for T6607: a persisted datetime formatting object reached this
    // component and crashed on `precision.toString()` because the object was
    // truthy but had no `precision` field.
    const mismatched = {
      date: 'YYYY-MM-DD',
      time: 'HH:mm',
      timeZone: 'Asia/Shanghai',
    } as IDatetimeFormatting as unknown as INumberFormatting;

    render(<NumberFormatting formatting={mismatched} onChange={vi.fn()} />);

    expect(screen.getByText('field.default.number.precision')).toBeInTheDocument();
  });
});
