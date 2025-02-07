/* eslint-disable sonarjs/no-duplicate-string */
import { CellValueType } from '../../models/field/constant';
import { TypedValue } from '../typed-value';
import {
  Concatenate,
  EncodeUrlComponent,
  Find,
  Left,
  Len,
  Lower,
  Mid,
  RegExpReplace,
  Replace,
  Rept,
  Right,
  Search,
  Substitute,
  T,
  Trim,
  Upper,
} from './text';

describe('TextFunc', () => {
  describe('Concatenate', () => {
    const concatenateFunc = new Concatenate();

    it('should concatenate strings correctly', () => {
      const result = concatenateFunc.eval([
        new TypedValue('Hello ', CellValueType.String, false),
        new TypedValue('World', CellValueType.String, false),
      ]);

      expect(result).toBe('Hello World');
    });

    it('should concatenate strings in arrays correctly', () => {
      const result = concatenateFunc.eval([
        new TypedValue(['Hello', 'World'], CellValueType.String, true),
      ]);

      expect(result).toBe('Hello, World');
    });
  });

  describe('Find', () => {
    const findFunc = new Find();
    const findString = 'Teable';
    const targetString = 'Hello, Teable';
    const targetMultipleValue = ['Hello', 'Teable'];

    it('should find the position in a string', () => {
      const result = findFunc.eval([
        new TypedValue(findString, CellValueType.String, false),
        new TypedValue(targetString, CellValueType.String, false),
      ]);

      expect(result).toBe(8);
    });

    it('should find the position in a multiple value', () => {
      const result = findFunc.eval([
        new TypedValue(findString, CellValueType.String, false),
        new TypedValue(targetMultipleValue, CellValueType.String, true),
      ]);

      expect(result).toBe(8);
    });

    it('should find the position in a string when the starting position is passed in', () => {
      const result = findFunc.eval([
        new TypedValue(findString, CellValueType.String, false),
        new TypedValue(targetString, CellValueType.String, false),
        new TypedValue(3, CellValueType.Number, false),
      ]);

      expect(result).toBe(8);
    });

    it('should return 0 when the incoming starting position is greater than the string position', () => {
      const result = findFunc.eval([
        new TypedValue(findString, CellValueType.String, false),
        new TypedValue(targetString, CellValueType.String, false),
        new TypedValue(10, CellValueType.Number, false),
      ]);

      expect(result).toBe(0);
    });

    it('should find the position in a multiple value when the starting position is a negative number', () => {
      const result = findFunc.eval([
        new TypedValue(findString, CellValueType.String, false),
        new TypedValue(targetMultipleValue, CellValueType.String, true),
        new TypedValue(-8, CellValueType.Number, false),
      ]);

      expect(result).toBe(8);
    });
  });

  describe('Search', () => {
    const searchFunc = new Search();
    const findString = 'Teable';
    const targetString = 'Hello, Teable';
    const targetMultipleValue = ['Hello', 'Teable'];

    it('should search the position in a string', () => {
      const result = searchFunc.eval([
        new TypedValue(findString, CellValueType.String, false),
        new TypedValue(targetString, CellValueType.String, false),
      ]);

      expect(result).toBe(8);
    });

    it('should search the position in a multiple value', () => {
      const result = searchFunc.eval([
        new TypedValue(findString, CellValueType.String, false),
        new TypedValue(targetMultipleValue, CellValueType.String, true),
      ]);

      expect(result).toBe(8);
    });

    it('should search the position in a string when the starting position is passed in', () => {
      const result = searchFunc.eval([
        new TypedValue(findString, CellValueType.String, false),
        new TypedValue(targetString, CellValueType.String, false),
        new TypedValue(3, CellValueType.Number, false),
      ]);

      expect(result).toBe(8);
    });

    it('should return null when the incoming starting position is greater than the string position', () => {
      const result = searchFunc.eval([
        new TypedValue(findString, CellValueType.String, false),
        new TypedValue(targetString, CellValueType.String, false),
        new TypedValue(10, CellValueType.Number, false),
      ]);

      expect(result).toBe(null);
    });

    it('should search the position in a multiple value when the starting position is a negative number', () => {
      const result = searchFunc.eval([
        new TypedValue(findString, CellValueType.String, false),
        new TypedValue(targetMultipleValue, CellValueType.String, true),
        new TypedValue(-8, CellValueType.Number, false),
      ]);

      expect(result).toBe(8);
    });
  });

  describe('Mid', () => {
    const midFunc = new Mid();
    const targetString = 'Hello, Teable';
    const targetMultipleValue = ['Hello', 'Teable'];

    it('should return a specific number of characters in a text string starting at a specified position', () => {
      const result = midFunc.eval([
        new TypedValue(targetString, CellValueType.String, false),
        new TypedValue(7, CellValueType.Number, false),
        new TypedValue(6, CellValueType.Number, false),
      ]);

      expect(result).toBe('Teable');
    });

    it('should return a specific number of characters in a multiple values starting at a specified position', () => {
      const result = midFunc.eval([
        new TypedValue(targetMultipleValue, CellValueType.String, true),
        new TypedValue(7, CellValueType.Number, false),
        new TypedValue(6, CellValueType.Number, false),
      ]);

      expect(result).toBe('Teable');
    });

    it('should return a blank string if truncate length is a negative number', () => {
      const result = midFunc.eval([
        new TypedValue(targetString, CellValueType.String, true),
        new TypedValue(7, CellValueType.Number, false),
        new TypedValue(-1, CellValueType.Number, false),
      ]);

      expect(result).toBe('');
    });

    it('should return an empty string when the specified position is greater than the position of the text', () => {
      const result = midFunc.eval([
        new TypedValue(targetString, CellValueType.String, true),
        new TypedValue(20, CellValueType.Number, false),
        new TypedValue(6, CellValueType.Number, false),
      ]);

      expect(result).toBe('');
    });
  });

  describe('Left', () => {
    const leftFunc = new Left();
    const targetString = 'Hello, Teable';
    const targetMultipleValue = ['Hello', 'Teable'];

    it('should return the leftmost character of a given string by default', () => {
      const result = leftFunc.eval([new TypedValue(targetString, CellValueType.String, false)]);

      expect(result).toBe('H');
    });

    it('should return the specified number of characters from the left of a given string', () => {
      const result = leftFunc.eval([
        new TypedValue(targetString, CellValueType.String, false),
        new TypedValue(5, CellValueType.Number, false),
      ]);

      expect(result).toBe('Hello');
    });

    it('should handle an array of strings and return the specified number of characters from the left', () => {
      const result = leftFunc.eval([
        new TypedValue(targetMultipleValue, CellValueType.String, true),
        new TypedValue(5, CellValueType.Number, false),
      ]);

      expect(result).toBe('Hello');
    });

    it('should return an empty string when provided with a negative number as count', () => {
      const result = leftFunc.eval([
        new TypedValue(targetMultipleValue, CellValueType.String, false),
        new TypedValue(-1, CellValueType.Number, false),
      ]);

      expect(result).toBe('');
    });
  });

  describe('Right', () => {
    const rightFunc = new Right();
    const targetString = 'Hello, Teable';
    const targetMultipleValue = ['Hello', 'Teable'];

    it('should return the rightmost character of a given string by default', () => {
      const result = rightFunc.eval([new TypedValue(targetString, CellValueType.String, false)]);

      expect(result).toBe('e');
    });

    it('should return the specified number of characters from the right of a given string', () => {
      const result = rightFunc.eval([
        new TypedValue(targetString, CellValueType.String, false),
        new TypedValue(6, CellValueType.Number, false),
      ]);

      expect(result).toBe('Teable');
    });

    it('should handle an array of strings and return the specified number of characters from the right', () => {
      const result = rightFunc.eval([
        new TypedValue(targetMultipleValue, CellValueType.String, true),
        new TypedValue(6, CellValueType.Number, false),
      ]);

      expect(result).toBe('Teable');
    });

    it('should return an empty string when provided with a negative number as count', () => {
      const result = rightFunc.eval([
        new TypedValue(targetMultipleValue, CellValueType.String, false),
        new TypedValue(-1, CellValueType.Number, false),
      ]);

      expect(result).toBe('');
    });
  });

  describe('Replace', () => {
    const replaceFunc = new Replace();
    const targetString = 'Hello, Teable';
    const targetMultipleValue = ['Hello', 'Teable'];

    it('should replace the substring starting at position in a given string', () => {
      const result = replaceFunc.eval([
        new TypedValue(targetString, CellValueType.String, false),
        new TypedValue(8, CellValueType.Number, false),
        new TypedValue(6, CellValueType.Number, false),
        new TypedValue('Table', CellValueType.String, false),
      ]);

      expect(result).toBe('Hello, Table');
    });

    it('should replace the substring starting at position in a given multiple values', () => {
      const result = replaceFunc.eval([
        new TypedValue(targetMultipleValue, CellValueType.String, true),
        new TypedValue(8, CellValueType.Number, false),
        new TypedValue(6, CellValueType.Number, false),
        new TypedValue('Table', CellValueType.String, false),
      ]);

      expect(result).toBe('Hello, Table');
    });

    it('should append the substring at the end when the starting position exceeds the string length', () => {
      const result = replaceFunc.eval([
        new TypedValue(targetString, CellValueType.String, false),
        new TypedValue(20, CellValueType.Number, false),
        new TypedValue(6, CellValueType.Number, false),
        new TypedValue('Table', CellValueType.String, false),
      ]);

      expect(result).toBe('Hello, TeableTable');
    });

    it('should append the substring before the substring when provided with a negative length', () => {
      const result = replaceFunc.eval([
        new TypedValue(targetString, CellValueType.String, false),
        new TypedValue(8, CellValueType.Number, false),
        new TypedValue(-1, CellValueType.Number, false),
        new TypedValue('Table', CellValueType.String, false),
      ]);

      expect(result).toBe('Hello, Table Teable');
    });
  });

  describe('RegExpReplace', () => {
    const regExpReplaceFunc = new RegExpReplace();
    const targetString = 'Hello, Teable';
    const targetMultipleValue = ['Hello', 'Teable'];

    it('should replace substring that matches pattern in string', () => {
      const result = regExpReplaceFunc.eval([
        new TypedValue(targetString, CellValueType.String, false),
        new TypedValue('H.* ', CellValueType.String, false),
        new TypedValue('', CellValueType.String, false),
      ]);

      expect(result).toBe('Teable');
    });

    it('should replace all substring that matches pattern in string', () => {
      const result = regExpReplaceFunc.eval([
        new TypedValue('ABC CBA', CellValueType.String, false),
        new TypedValue('C', CellValueType.String, false),
        new TypedValue('D', CellValueType.String, false),
      ]);

      expect(result).toBe('ABD DBA');
    });

    it('should replace substring when input is an array', () => {
      const result = regExpReplaceFunc.eval([
        new TypedValue(targetMultipleValue, CellValueType.String, true),
        new TypedValue('H.* ', CellValueType.String, false),
        new TypedValue('', CellValueType.String, false),
      ]);

      expect(result).toBe('Teable');
    });
  });

  describe('Substitute', () => {
    const substituteFunc = new Substitute();
    const targetString = 'Hello, Teable';
    const targetMultipleValue = ['Hello', 'Teable'];

    it('should substitute the specified string in the target string', () => {
      const result = substituteFunc.eval([
        new TypedValue(targetString, CellValueType.String, false),
        new TypedValue('Teable', CellValueType.String, false),
        new TypedValue('Table', CellValueType.String, false),
      ]);

      expect(result).toBe('Hello, Table');
    });

    it('should substitute the specified string in the target string given a specific instance number', () => {
      const result = substituteFunc.eval([
        new TypedValue(targetString, CellValueType.String, false),
        new TypedValue('Teable', CellValueType.String, false),
        new TypedValue('Table', CellValueType.String, false),
        new TypedValue(1, CellValueType.Number, false),
      ]);

      expect(result).toBe('Hello, Table');
    });

    it('should handle an array of strings and substitute the specified string given a specific instance number', () => {
      const result = substituteFunc.eval([
        new TypedValue(targetMultipleValue, CellValueType.String, true),
        new TypedValue('Teable', CellValueType.String, false),
        new TypedValue('Table', CellValueType.String, false),
        new TypedValue(1, CellValueType.Number, false),
      ]);

      expect(result).toBe('Hello, Table');
    });

    it('should substitute the specified string in the target string even with a negative instance number', () => {
      const result = substituteFunc.eval([
        new TypedValue(targetString, CellValueType.String, false),
        new TypedValue('Teable', CellValueType.String, false),
        new TypedValue('Table', CellValueType.String, false),
        new TypedValue(-1, CellValueType.Number, false),
      ]);

      expect(result).toBe('Hello, Table');
    });
  });

  describe('Lower', () => {
    const lowerFunc = new Lower();
    const targetString = 'Hello, Teable';
    const targetMultipleValue = ['Hello', 'Teable'];

    it('should convert a given string to lowercase', () => {
      const result = lowerFunc.eval([new TypedValue(targetString, CellValueType.String, false)]);

      expect(result).toBe('hello, teable');
    });

    it('should handle an array of strings and convert them to lowercase', () => {
      const result = lowerFunc.eval([
        new TypedValue(targetMultipleValue, CellValueType.String, true),
      ]);

      expect(result).toBe('hello, teable');
    });
  });

  describe('Upper', () => {
    const upperFunc = new Upper();
    const targetString = 'Hello, Teable';
    const targetMultipleValue = ['Hello', 'Teable'];

    it('should convert a given string to uppercase', () => {
      const result = upperFunc.eval([new TypedValue(targetString, CellValueType.String, false)]);

      expect(result).toBe('HELLO, TEABLE');
    });

    it('should handle an array of strings and convert them to uppercase', () => {
      const result = upperFunc.eval([
        new TypedValue(targetMultipleValue, CellValueType.String, true),
      ]);

      expect(result).toBe('HELLO, TEABLE');
    });
  });

  describe('Rept', () => {
    const reptFunc = new Rept();
    const targetString = 'Hello, Teable';
    const targetMultipleValue = ['Hello', 'Teable'];

    it('should repeat the given string based on the provided number', () => {
      const result = reptFunc.eval([
        new TypedValue(targetString, CellValueType.String, false),
        new TypedValue(2, CellValueType.Number, false),
      ]);

      expect(result).toBe('Hello, TeableHello, Teable');
    });

    it('should handle an array of strings and repeat based on the provided number', () => {
      const result = reptFunc.eval([
        new TypedValue(targetMultipleValue, CellValueType.String, true),
        new TypedValue(2, CellValueType.Number, false),
      ]);

      expect(result).toBe('Hello, TeableHello, Teable');
    });

    it('should return null when the repeat count is zero', () => {
      const result = reptFunc.eval([
        new TypedValue(targetMultipleValue, CellValueType.String, true),
        new TypedValue(0, CellValueType.Number, false),
      ]);

      expect(result).toBe(null);
    });
  });

  describe('Trim', () => {
    const trimFunc = new Trim();
    const targetString = ' Hello, Teable ';
    const targetMultipleValue = [' Hello', 'Teable '];

    it('should remove leading and trailing spaces from a given string', () => {
      const result = trimFunc.eval([new TypedValue(targetString, CellValueType.String, false)]);

      expect(result).toBe('Hello, Teable');
    });

    it('should handle an array of strings and remove leading and trailing spaces from each', () => {
      const result = trimFunc.eval([
        new TypedValue(targetMultipleValue, CellValueType.String, true),
      ]);

      expect(result).toBe('Hello, Teable');
    });
  });

  describe('T', () => {
    const tFunc = new T();

    it('should return the input string when provided a string value', () => {
      const result = tFunc.eval([new TypedValue('Teable', CellValueType.String, false)]);

      expect(result).toBe('Teable');
    });

    it('should concatenate and return string array elements as a single string', () => {
      const result = tFunc.eval([new TypedValue(['Hello', 'Teable'], CellValueType.String, true)]);

      expect(result).toBe('Hello, Teable');
    });

    it('should return null when provided a number', () => {
      const result = tFunc.eval([new TypedValue(100, CellValueType.Number, false)]);

      expect(result).toBe(null);
    });

    it('should return null when provided a boolean value', () => {
      const result = tFunc.eval([new TypedValue(true, CellValueType.Boolean, false)]);

      expect(result).toBe(null);
    });
  });

  describe('Len', () => {
    const lenFunc = new Len();
    const targetString = 'Hello, Teable';
    const targetMultipleValue = ['Hello', 'Teable'];

    it('should return the length of a given string', () => {
      const result = lenFunc.eval([new TypedValue(targetString, CellValueType.String, false)]);

      expect(result).toBe(13);
    });

    it('should handle an array of strings and return the combined length', () => {
      const result = lenFunc.eval([
        new TypedValue(targetMultipleValue, CellValueType.String, true),
      ]);

      expect(result).toBe(13);
    });
  });

  describe('EncodeUrlComponent', () => {
    const encodeUrlComponentFunc = new EncodeUrlComponent();
    const targetString = 'Hello, Teable';
    const targetMultipleValue = ['Hello', 'Teable'];

    it('should correctly encode a string with special characters for a URL component', () => {
      const result = encodeUrlComponentFunc.eval([
        new TypedValue(targetString, CellValueType.String, false),
      ]);

      expect(result).toBe('Hello%2C%20Teable');
    });

    it('should concatenate and correctly encode string array elements for a URL component', () => {
      const result = encodeUrlComponentFunc.eval([
        new TypedValue(targetMultipleValue, CellValueType.String, true),
      ]);

      expect(result).toBe('Hello%2C%20Teable');
    });
  });
});
