import type { IDatetimeFormatting } from '@teable/core';
import { DateFormattingPreset, TimeFormatting } from '@teable/core';
import { useState } from 'react';
import { render, screen, userEvent } from '@/test-utils';
import { DatetimeFormatting } from './DatetimeFormatting';

const locale = vi.hoisted(() => ({ language: 'zh' }));
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: locale }),
}));

const initial: IDatetimeFormatting = {
  date: DateFormattingPreset.ISO,
  time: TimeFormatting.None,
  timeZone: 'Asia/Shanghai',
};

const Editor = ({ formatting = initial }: { formatting?: IDatetimeFormatting }) => {
  const [saved, setSaved] = useState(formatting);
  const [version, setVersion] = useState(0);
  return (
    <>
      <DatetimeFormatting key={version} formatting={saved} onChange={setSaved} />
      <output aria-label="Saved formatting">{JSON.stringify(saved)}</output>
      <button onClick={() => setVersion((value) => value + 1)}>Reopen editor</button>
    </>
  );
};

const savedFormatting = () =>
  JSON.parse(screen.getByLabelText('Saved formatting').textContent || '{}');
const dateTrigger = () => screen.getAllByRole('combobox')[0];
const optionName = (name: string) =>
  new RegExp(`^${name === 'ISO' ? name : `table:field.default.date.${name}`} \\(`);

const chooseDate = async (name: string) => {
  await userEvent.click(dateTrigger());
  await userEvent.click(screen.getByRole('option', { name: optionName(name) }));
};

describe('date formatting preset identity (T7784)', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.scrollIntoView ??= () => undefined;
  });

  beforeEach(() => {
    locale.language = 'zh';
  });

  // Each preset is an independent interaction, not eleven choices sharing one test deadline.
  it.each([
    ['local', 'YYYY-MM-DD'],
    ['friendly', 'YYYY 年 M 月 D 日'],
    ['us', 'M/D/YYYY'],
    ['european', 'D/M/YYYY'],
    ['asia', 'YYYY/MM/DD'],
    ['ISO', 'YYYY-MM-DD'],
    ['yearMonth', 'YYYY-MM'],
    ['monthDay', 'MM-DD'],
    ['year', 'YYYY'],
    ['month', 'MM'],
    ['day', 'DD'],
  ])('maps the %s selection to its format string', async (name, format) => {
    render(<Editor />);
    await userEvent.click(dateTrigger());
    expect(screen.getAllByRole('option')).toHaveLength(11);
    await userEvent.click(screen.getByRole('option', { name: optionName(name) }));
    expect(dateTrigger()).toHaveTextContent(optionName(name));
    expect(savedFormatting()).toEqual({ ...initial, date: format });
  });

  it.each([
    ['zh', 'ISO', DateFormattingPreset.ISO],
    ['en', 'us', DateFormattingPreset.US],
    ['ja', 'asia', DateFormattingPreset.Asian],
  ])(
    'keeps equal-value Local and %s preset choices distinct until reopening',
    async (language, preset, date) => {
      locale.language = language;
      render(<Editor formatting={{ ...initial, date }} />);
      expect(dateTrigger()).toHaveTextContent(optionName('local'));
      await chooseDate(preset);
      expect(dateTrigger()).toHaveTextContent(optionName(preset));
      expect(savedFormatting()).toEqual({ ...initial, date });
      await chooseDate('local');
      expect(dateTrigger()).toHaveTextContent(optionName('local'));
      await chooseDate(preset);
      await userEvent.click(screen.getByRole('button', { name: 'Reopen editor' }));
      expect(dateTrigger()).toHaveTextContent(optionName('local'));
      expect(savedFormatting()).toEqual({ ...initial, date });
    }
  );

  it('preserves the ISO selection and date/timezone while changing all three time formats', async () => {
    render(<Editor />);
    await chooseDate('ISO');
    for (const [name, time] of [
      ['24Hour', TimeFormatting.Hour24],
      ['12Hour', TimeFormatting.Hour12],
      ['noDisplay', TimeFormatting.None],
    ]) {
      await userEvent.click(screen.getAllByRole('combobox')[1]);
      expect(screen.getAllByRole('option')).toHaveLength(3);
      await userEvent.click(
        screen.getByRole('option', { name: `table:field.default.date.${name}` })
      );
      expect(dateTrigger()).toHaveTextContent(/^ISO \(/);
      expect(savedFormatting()).toEqual({ ...initial, time });
    }
  });

  it('retains a non-preset custom format across other edits and reopening', async () => {
    const custom = { ...initial, date: 'YYYY.MM.DD' };
    render(<Editor formatting={custom} />);
    expect(dateTrigger()).toHaveTextContent(optionName('custom'));
    await userEvent.click(dateTrigger());
    expect(screen.getAllByRole('option')).toHaveLength(12);
    await userEvent.click(screen.getByRole('option', { name: optionName('custom') }));
    expect(savedFormatting()).toEqual(custom);
    await userEvent.click(screen.getAllByRole('combobox')[1]);
    await userEvent.click(screen.getByRole('option', { name: 'table:field.default.date.24Hour' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reopen editor' }));
    expect(dateTrigger()).toHaveTextContent(optionName('custom'));
    expect(savedFormatting()).toEqual({ ...custom, time: TimeFormatting.Hour24 });
  });
});
