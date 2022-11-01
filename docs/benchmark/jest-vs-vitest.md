# Unit tests bench

Vitest: 4 secs
Jest: 29 secs

### Vitest

- Vitest 0.12.6
- Happy-dom 3+
- Coverage with c8

```
hyperfine "yarn vitest run --coverage"
Benchmark 1: yarn vitest run --coverage
  Time (mean ± σ):      4.205 s ±  0.446 s    [User: 11.726 s, System: 0.869 s]
  Range (min … max):    3.803 s …  5.236 s    10 runs
```

### Jest

- Jest 28.1.0 + ts-jest

```
hyperfine "yarn jest  --coverage"
Benchmark 1: yarn jest  --coverage
  Time (mean ± σ):     29.022 s ±  0.897 s    [User: 273.365 s, System: 8.163 s]
  Range (min … max):   28.096 s … 30.664 s    10 runs
```
