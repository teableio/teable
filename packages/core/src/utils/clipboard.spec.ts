import { parseClipboardText, stringifyClipboardText } from './clipboard';

describe('clipboard', () => {
  const parseData = [
    ['John', '20', 'light'],
    ['Tom', '30', 'medium'],
    ['A\nB\nC\n"', '40', 'heavy'],
  ];

  const stringifyData = `John\t20\tlight\nTom\t30\tmedium\n"A\nB\nC\n"""\t40\theavy`;

  it('parseClipboardText', () => {
    const { data } = parseClipboardText(stringifyData);
    expect(data).toEqual(parseData);
  });

  it('extractTableHeader should return undefined from non-teable HTML', () => {
    const result = stringifyClipboardText(parseData);
    expect(result).toEqual(stringifyData);
  });
});
