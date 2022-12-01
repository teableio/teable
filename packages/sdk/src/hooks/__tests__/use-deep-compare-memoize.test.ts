import { renderHook } from '@testing-library/react-hooks';
import { useDeepCompareMemoize } from '../use-deep-compare-memoize';

describe('useDeepCompareMemoize', () => {
  it('should not mutate references', () => {
    const val = {
      fn: () => {},
    };
    const { result } = renderHook(() => useDeepCompareMemoize(val));
    const ret = result.current as typeof val;
    expect(ret.fn).toStrictEqual(val.fn);
  });
});
