import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { mailTransportConfigSchema, MailBodyType } from './types';

export function toEmailArray(email: string | string[] | undefined): string[] | undefined {
  if (!email) return undefined;
  return Array.isArray(email) ? email : [email];
}

const emailOrArray = z.email().or(z.array(z.email())).optional();

// Cap recipients per request so a single call can't fan out into a mass send.
const MAX_RECIPIENTS = 50;

export const sendEmailRoSchema = z
  .object({
    to: emailOrArray,
    subject: z.string(),
    body: z.string(),
    cc: emailOrArray,
    bcc: emailOrArray,
    replyTo: z.email().optional(),
    smtp: mailTransportConfigSchema.optional(),
    bodyType: z.enum(MailBodyType).default(MailBodyType.Markdown),
  })
  .refine(
    (data) => (toEmailArray(data.to)?.length ?? 0) > 0 || (toEmailArray(data.bcc)?.length ?? 0) > 0,
    {
      message: 'Either "to" or "bcc" must be provided',
      path: ['to'],
    }
  )
  .refine(
    (data) =>
      (toEmailArray(data.to)?.length ?? 0) +
        (toEmailArray(data.cc)?.length ?? 0) +
        (toEmailArray(data.bcc)?.length ?? 0) <=
      MAX_RECIPIENTS,
    {
      message: `A maximum of ${MAX_RECIPIENTS} recipients (to + cc + bcc) is allowed per request`,
    }
  );

export type ISendEmailRo = z.infer<typeof sendEmailRoSchema>;

export const sendEmailVoSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type ISendEmailVo = z.infer<typeof sendEmailVoSchema>;

export const SEND_EMAIL = '/mail-sender/{baseId}/send';

export const SendEmailRoute: RouteConfig = registerRoute({
  method: 'post',
  path: SEND_EMAIL,
  description: 'Send an email',
  request: {
    params: z.object({ baseId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: sendEmailRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Email sent successfully.',
      content: {
        'application/json': {
          schema: sendEmailVoSchema,
        },
      },
    },
  },
  tags: ['mail'],
});

export const sendEmail = async (baseId: string, ro: ISendEmailRo) => {
  return await axios.post<ISendEmailVo>(urlBuilder(SEND_EMAIL, { baseId }), ro);
};
