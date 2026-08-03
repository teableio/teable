import {
  isJsonApiErrorResponse,
  isJsonApiResponse,
  isJsonApiSuccessResponse,
} from '../json-api.typeguard';

describe('json-api typeguards', () => {
  describe('isJsonApiResponse', () => {
    it('should accept valid json responses', () => {
      const payload = {
        success: true,
        data: 'cool',
        meta: {},
      };
      expect(isJsonApiResponse(payload)).toBeTruthy();
    });

    it('should reject invalid json responses', () => {
      const payload = {
        success: 'biloute',
        meta: {},
      };
      expect(isJsonApiResponse(payload)).toBeFalsy();
    });
  });

  describe('isJsonApiSuccessResponse', () => {
    it('should say yes when payload is success', () => {
      const payload = {
        success: true,
        data: 'cool',
        meta: {},
      };
      expect(isJsonApiSuccessResponse(payload)).toBeTruthy();
    });

    it('should say no when payload is success', () => {
      const payload = {
        success: false,
        data: 'cool',
        meta: {},
      };
      expect(isJsonApiSuccessResponse(payload)).toBeFalsy();
    });
  });

  describe('isJsonApiErrorResponse', () => {
    it('should say false when payload is success', () => {
      const payload = {
        success: true,
        data: 'cool',
        meta: {},
      };
      expect(isJsonApiErrorResponse(payload)).toBeFalsy();
    });

    it('should say yes when payload is error', () => {
      const payload = {
        success: false,
        errors: [],
      };
      expect(isJsonApiErrorResponse(payload)).toBeTruthy();
    });
  });
});
