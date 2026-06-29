import { describe, expect, it } from 'vitest';
import { sendEmailRoSchema } from './send';

const smtp = {
  sender: 'no-reply@example.com',
  host: 'smtp.example.com',
  port: 587,
  auth: { user: 'user', pass: 'pass' },
};

describe('sendEmailRoSchema', () => {
  const base = { subject: 'hi', body: '**hello**', to: 'a@b.com' };

  it('passes for custom SMTP', () => {
    const result = sendEmailRoSchema.safeParse({ ...base, smtp });
    expect(result.success).toBe(true);
  });

  it('passes for system SMTP (no smtp config in body)', () => {
    const result = sendEmailRoSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('requires either `to` or `bcc`', () => {
    const result = sendEmailRoSchema.safeParse({ subject: 'hi', body: 'x' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.includes('to'))).toBe(true);
  });

  it('passes for a bcc-only send (no `to`)', () => {
    const result = sendEmailRoSchema.safeParse({ subject: 'hi', body: 'x', bcc: 'a@b.com' });
    expect(result.success).toBe(true);
  });

  it('accepts arrays for `to` and `bcc`', () => {
    const result = sendEmailRoSchema.safeParse({ ...base, to: ['a@b.com', 'c@d.com'] });
    expect(result.success).toBe(true);
  });

  it('rejects more than 50 recipients across to + cc + bcc', () => {
    const many = Array.from({ length: 51 }, (_, i) => `u${i}@b.com`);
    const result = sendEmailRoSchema.safeParse({ subject: 'hi', body: 'x', to: many });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes('maximum'))).toBe(true);
  });

  it('strips client-supplied headers (header injection surface removed)', () => {
    const result = sendEmailRoSchema.safeParse({ ...base, headers: { Bcc: 'victim@b.com' } });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('headers');
  });
});
