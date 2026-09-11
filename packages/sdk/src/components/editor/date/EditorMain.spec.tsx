import { TimeFormatting } from '@teable/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppContext } from '../../../context';
import type * as I18n from '../../../context/app/i18n';
import { DateEditorMain } from './EditorMain';

// A browser west of the configured zone: New York midnight is still the previous day here.
process.env.TZ = 'America/Los_Angeles';

vi.mock('../../../context/app/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof I18n>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AppContext.Provider value={{ lang: 'en' } as never}>{children}</AppContext.Provider>
);

const dayButton = (day: string) =>
  screen
    .getAllByText(day)
    .map((el) => el.closest('button'))
    .find(Boolean) as HTMLButtonElement;

describe('DateEditorMain', () => {
  it('keeps the wall clock of the configured zone when another day is picked', () => {
    expect(new Date('2026-09-15T04:00:00.000Z').getDate()).toBe(14);
    const onChange = vi.fn();
    render(
      <DateEditorMain
        value="2026-09-11T02:00:00.000Z"
        options={{
          formatting: {
            date: 'YYYY-MM-DD',
            time: TimeFormatting.Hour24,
            timeZone: 'America/New_York',
          },
        }}
        onChange={onChange}
      />,
      { wrapper }
    );
    // 22:00 in New York on the 10th stays 22:00 in New York on the 15th, whatever the browser zone
    fireEvent.click(dayButton('15'));
    expect(onChange).toHaveBeenCalledWith('2026-09-16T02:00:00.000Z');
  });

  it('moves to today on the calendar of the configured zone, keeping the clock', () => {
    // 22:00Z is still the 10th in Los Angeles but already the 11th in Tokyo
    vi.useFakeTimers({ now: new Date('2026-09-10T22:00:00.000Z') });
    const onChange = vi.fn();
    render(
      <DateEditorMain
        value="2026-09-10T00:00:00.000Z"
        options={{
          formatting: { date: 'YYYY-MM-DD', time: TimeFormatting.Hour24, timeZone: 'Asia/Tokyo' },
        }}
        onChange={onChange}
      />,
      { wrapper }
    );
    fireEvent.click(screen.getByText('editor.date.today'));
    vi.useRealTimers();
    expect(onChange).toHaveBeenCalledWith('2026-09-11T00:00:00.000Z');
  });

  it('starts an empty value at the picked day with the current clock of the configured zone', () => {
    vi.useFakeTimers({ now: new Date('2026-09-10T13:30:00.000Z') });
    const onChange = vi.fn();
    render(
      <DateEditorMain
        options={{
          formatting: { date: 'YYYY-MM-DD', time: TimeFormatting.Hour24, timeZone: 'UTC' },
        }}
        onChange={onChange}
      />,
      { wrapper }
    );
    fireEvent.click(dayButton('15'));
    vi.useRealTimers();
    expect(onChange).toHaveBeenCalledWith('2026-09-15T13:30:00.000Z');
  });
});
