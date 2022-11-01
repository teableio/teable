import { JsonApiResponseFactory } from '../json-api-response.factory';
import type { JsonApiError } from '../json-api-response.types';

describe('jsonApiResponseFactory tests', () => {
  describe('when creating a success from a string', () => {
    it('should decode the json', () => {
      const data = [
        {
          name: 'seb',
        },
      ] as const;
      const resp = JsonApiResponseFactory.fromSuccess<typeof data>(data, {
        total: data.length,
      });
      expect(resp).toStrictEqual({
        success: true,
        data: data,
        meta: {
          total: data.length,
        },
      });
    });
  });

  describe('when creating an error from a string', () => {
    it('should set the string in the detail', () => {
      const resp = JsonApiResponseFactory.fromError('error');
      expect(resp.errors?.[0]).toMatchObject({
        title: 'error',
      });
    });
    it('should set the httpStatus in the status', () => {
      const resp = JsonApiResponseFactory.fromError('error', 422);
      expect(resp.errors?.[0]).toMatchObject({
        status: 422,
      });
    });
  });
  describe('when creating an error from a JsonApiError', () => {
    it('should set create the same payload', () => {
      const err: JsonApiError = {
        code: 'whatever',
        title: 'Hello',
        id: 'wxncn',
        status: 422,
      };
      const resp = JsonApiResponseFactory.fromError(err);
      expect(resp.errors?.[0]).toStrictEqual(err);
    });
  });

  describe('when creating an error from a Array<JsonApiError>', () => {
    it('should set create the same payload', () => {
      const errs: JsonApiError[] = [
        {
          title: 'Hello',
        },
        {
          title: 'Hello3',
          status: 422,
        },
      ];
      const resp = JsonApiResponseFactory.fromError(errs);
      expect(resp.errors).toStrictEqual(errs);
    });
  });
});
