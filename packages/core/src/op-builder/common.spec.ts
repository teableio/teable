import { pathMatcher } from './common';

describe('Common', () => {
  it('should match path with named parameter and return correct params', () => {
    const path = ['user', 123];
    const matchList = ['user', ':id'];
    const result = pathMatcher<{ id: number }>(path, matchList);
    expect(result).toEqual({ id: 123 });
  });

  it('should not match path with different length', () => {
    const path = ['user', '123', 'profile'];
    const matchList = ['user', ':id'];
    const result = pathMatcher<{ id: number }>(path, matchList);
    expect(result).toBeNull();
  });

  it('should not match path with different values', () => {
    const path = ['user', '123', 'profile'];
    const matchList = ['user', ':id', 'settings'];
    const result = pathMatcher<{ id: number }>(path, matchList);
    expect(result).toBeNull();
  });

  it('should not match path if wildcard (*) is before actual path length', () => {
    const path = ['user', '123'];
    const matchList = ['user', '*', 'profile'];
    const result = pathMatcher<{ id: number }>(path, matchList);
    expect(result).toBeNull();
  });

  it('should not match path if wildcard (*) is more then actual path length', () => {
    const path = ['user', '123'];
    const matchList = ['user', '123', '*'];
    const result = pathMatcher<{ id: number }>(path, matchList);
    expect(result).toBeNull();
  });

  it('should not match path if wildcard (*) is less then actual path length', () => {
    const path = ['user', '123', 'key'];
    const matchList = ['user', '*'];
    const result = pathMatcher<{ id: number }>(path, matchList);
    expect(result).toBeNull();
  });
});
