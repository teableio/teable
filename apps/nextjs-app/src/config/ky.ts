import type { NormalizedOptions } from 'ky';
import { KyFactory } from '@/lib/factory/ky.factory';

export const ky = new KyFactory({
  onAuthFailure: (
    _request: Request,
    _options: NormalizedOptions,
    _response: Response
  ) => {
    console.log('do whatever');
  },
}).create({
  timeout: 10000,
  retry: {
    limit: 3,
    statusCodes: [408, 413, 429, 500, 502, 503, 504],
    afterStatusCodes: [413, 429, 503],
    methods: ['get', 'put', 'head', 'delete', 'options', 'trace'],
  },
});
