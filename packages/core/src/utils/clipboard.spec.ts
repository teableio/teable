import { parseClipboardText, stringifyClipboardText } from './clipboard';

describe('clipboard', () => {
  const parseData = [
    ['John', '20', 'light'],
    ['Tom', '30', 'medium'],
    ['A\nB\nC\n"', '40', 'heavy'],
  ];

  const stringifyData = 'John\t20\tlight\nTom\t30\tmedium\n"A\nB\nC\n"""\t40\theavy';

  it('parseClipboardText', () => {
    const data = parseClipboardText(stringifyData);
    expect(data).toEqual(parseData);
  });

  it('extractTableHeader should return undefined from non-teable HTML', () => {
    const result = stringifyClipboardText(parseData);
    expect(result).toEqual(stringifyData);
  });

  describe('parse', () => {
    it('content has normal', () => {
      const data = parseClipboardText('11\t22\t33\n44\t55\t66');
      expect(data).toEqual([
        ['11', '22', '33'],
        ['44', '55', '66'],
      ]);
    });
    it('content has "', () => {
      const data = parseClipboardText('123');
      expect(data).toEqual([['123']]);
    });

    it('content has ""', () => {
      const data = parseClipboardText('"1"2"3"\t"4"5"6"');
      expect(data).toEqual([['"1"2"3"', '"4"5"6"']]);
    });

    it('content has " many', () => {
      const data = parseClipboardText('"1""2"3"\t"4""5"6"');
      expect(data).toEqual([['"1"2"3"', '"4"5"6"']]);
    });

    it('content has newline', () => {
      const data = parseClipboardText('"1\n2"');
      expect(data).toEqual([['1\n2']]);
    });

    it('content has newline and delimiter', () => {
      const data = parseClipboardText('"1\n2\t3"');
      expect(data).toEqual([['1\n2\t3']]);
    });

    it('content has newline and delimiter and "', () => {
      const data = parseClipboardText('"1\n2\t""3"\t"""1\n2\t""3"\n"1\n2\t""3"\t"1\n2\t""3"');
      expect(data).toEqual([
        ['1\n2\t"3', '"1\n2\t"3'],
        ['1\n2\t"3', '1\n2\t"3'],
      ]);
    });

    it('content has double-quoted sentence and end of null', () => {
      const data = parseClipboardText('"text1"\t"text2"\t');
      expect(data).toEqual([['"text1"', '"text2"', '']]);
    });

    it('content has continuous \t', () => {
      const data = parseClipboardText('text1\t\t"text2"');
      expect(data).toEqual([['text1', '', '"text2"']]);
    });

    it('content hash continuous \n', () => {
      const data = parseClipboardText('text1\n\n"text2"');
      expect(data).toEqual([['text1'], [''], ['"text2"']]);
    });

    it('content has windows newline', () => {
      const data = parseClipboardText('text1"\r\ntext2');
      expect(data).toEqual([['text1"'], ['text2']]);
    });

    it('content start or end with newline', () => {
      const data = parseClipboardText('text1\n');
      expect(data).toEqual([['text1']]);

      const data2 = parseClipboardText('\ntext1');
      expect(data2).toEqual([['text1']]);

      const data3 = parseClipboardText('tex"t1\n');
      expect(data3).toEqual([['tex"t1']]);

      const data4 = parseClipboardText('\ntex"t1');
      expect(data4).toEqual([['tex"t1']]);
    });
  });

  describe('stringify', () => {
    it('content has "', () => {
      const result = stringifyClipboardText([['"123']]);
      expect(result).toEqual('"123');
    });
    it('content has newline', () => {
      const result = stringifyClipboardText([['1\n2']]);
      expect(result).toEqual('"1\n2"');
    });
    it('content has newline and delimiter', () => {
      const result = stringifyClipboardText([['1\n2\t3']]);
      expect(result).toEqual('"1\n2\t3"');
    });
    it('content has newline and delimiter and "', () => {
      const result = stringifyClipboardText([
        ['1\n2\t"3', '1\n2\t"3'],
        ['1\n2\t"3', '1\n2\t"3'],
      ]);
      expect(result).toEqual('"1\n2\t""3"\t"1\n2\t""3"\n"1\n2\t""3"\t"1\n2\t""3"');
    });
  });
});
