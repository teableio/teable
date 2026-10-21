import { render, screen, userEvent } from '@/test-utils';
import { NumberOptions } from './NumberOptions';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('../formatting/NumberFormatting', () => ({
  NumberFormatting: () => null,
}));

vi.mock('../show-as/MultiNumberShowAs', () => ({
  MultiNumberShowAs: () => null,
}));

vi.mock('../show-as/SingleNumberShowAs', () => ({
  SingleNumberShowAs: () => null,
}));

const defaultInput = () => screen.getByRole('spinbutton');

describe('number field default value (T7852)', () => {
  it('shows a saved default of 0 when the editor reopens', () => {
    render(<NumberOptions options={{ defaultValue: 0 }} />);

    expect(defaultInput()).toHaveValue(0);
  });

  it('keeps a non-zero default and an empty default distinct', () => {
    const { rerender } = render(<NumberOptions options={{ defaultValue: 12 }} />);
    expect(defaultInput()).toHaveValue(12);

    rerender(<NumberOptions options={{ defaultValue: null }} />);
    expect(defaultInput()).toHaveValue(null);
  });

  it('saves a typed 0 instead of clearing the default', async () => {
    const onChange = vi.fn();
    render(<NumberOptions options={{ defaultValue: null }} onChange={onChange} />);

    await userEvent.type(defaultInput(), '0');

    expect(onChange).toHaveBeenLastCalledWith({ defaultValue: 0 });
  });
});
