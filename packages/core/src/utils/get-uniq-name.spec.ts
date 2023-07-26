import { getUniqName } from './get-uniq-name'; // Replace with your actual file

describe('getUniqName', () => {
  it('should start with 2', () => {
    const existNames = ['Field'];
    const name = 'Field';
    expect(getUniqName(name, existNames)).toBe('Field 2');
  });

  it('should return the original name if it does not exist in the list', () => {
    const existNames = ['Field 1', 'Field 2', 'Field 3'];
    const name = 'Field 4';
    expect(getUniqName(name, existNames)).toBe('Field 4');
  });

  it('should increment the number at the end of the name if the name exists in the list', () => {
    const existNames = ['Field 1', 'Field 2', 'Field 3'];
    const name = 'Field 3';
    expect(getUniqName(name, existNames)).toBe('Field 4');
  });

  it('should add a number at the end of the name if the name exists in the list and does not have a number', () => {
    const existNames = ['Field', 'Field 1', 'Field 2'];
    const name = 'Field';
    expect(getUniqName(name, existNames)).toBe('Field 3');
  });

  it('should increment the number at the end of the name even if there are other names with higher numbers', () => {
    const existNames = ['Field 1', 'Field 3', 'Field 4'];
    const name = 'Field 3';
    expect(getUniqName(name, existNames)).toBe('Field 5');
  });

  it('should correctly handle names with numbers in the middle', () => {
    const existNames = ['Field 1 1', 'Field 1 2', 'Field 1 3'];
    const name = 'Field 1 3';
    expect(getUniqName(name, existNames)).toBe('Field 1 4');
  });
});
