import { describe, it, expect } from 'vitest';
import {
  isEmailDomainBanned,
  isValidBannedEmailDomain,
  normalizeBannedEmailDomains,
} from './banned-email-domains';

describe('banned-email-domains', () => {
  describe('normalizeBannedEmailDomains', () => {
    it('should split on newlines and commas, strip @, lowercase and dedupe', () => {
      expect(normalizeBannedEmailDomains('@TankMail.cn\nexample.com, tankmail.cn;  ')).toEqual([
        'tankmail.cn',
        'example.com',
      ]);
    });

    it('should return empty array for blank input', () => {
      expect(normalizeBannedEmailDomains('  \n ')).toEqual([]);
    });
  });

  describe('isValidBannedEmailDomain', () => {
    it('should accept registrable domains including subdomains and punycode', () => {
      expect(isValidBannedEmailDomain('tankmail.cn')).toBe(true);
      expect(isValidBannedEmailDomain('mx.tank-mail.co.uk')).toBe(true);
      expect(isValidBannedEmailDomain('xn--fiq228c.cn')).toBe(true);
    });

    it('should reject bare TLDs and garbage', () => {
      expect(isValidBannedEmailDomain('cn')).toBe(false);
      expect(isValidBannedEmailDomain('ss')).toBe(false);
      expect(isValidBannedEmailDomain('12')).toBe(false);
      expect(isValidBannedEmailDomain('foo..bar')).toBe(false);
      expect(isValidBannedEmailDomain('-foo.bar')).toBe(false);
      expect(isValidBannedEmailDomain('foo.bar-')).toBe(false);
      expect(isValidBannedEmailDomain('foo.123')).toBe(false);
    });
  });

  describe('isEmailDomainBanned', () => {
    const banned = ['tankmail.cn'];

    it('should match the domain case-insensitively', () => {
      expect(isEmailDomainBanned('user@tankmail.cn', banned)).toBe(true);
      expect(isEmailDomainBanned('user@TankMail.CN', banned)).toBe(true);
      expect(isEmailDomainBanned('user@gmail.com', banned)).toBe(false);
    });

    it('should match subdomains but not suffix look-alikes', () => {
      expect(isEmailDomainBanned('user@mx.tankmail.cn', banned)).toBe(true);
      expect(isEmailDomainBanned('user@nottankmail.cn', banned)).toBe(false);
    });

    it('should tolerate a leading @ in the configured domain', () => {
      expect(isEmailDomainBanned('user@tankmail.cn', ['@tankmail.cn'])).toBe(true);
    });

    it('should return false for empty config or malformed email', () => {
      expect(isEmailDomainBanned('user@tankmail.cn', [])).toBe(false);
      expect(isEmailDomainBanned('user@tankmail.cn', null)).toBe(false);
      expect(isEmailDomainBanned('no-at-sign', banned)).toBe(false);
    });
  });
});
