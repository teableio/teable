import type { MailerService } from '@nestjs-modules/mailer';
import type { IMailTransportConfig } from '@teable/openapi';
import { createTransport } from 'nodemailer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMailConfig } from '../../configs/mail.config';
import { MailSenderService } from './mail-sender.service';

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(),
}));

const mockedCreateTransport = vi.mocked(createTransport);

const smtpConfig: IMailTransportConfig = {
  host: 'smtp.example.com',
  port: 465,
  secure: true,
  sender: 'noreply@example.com',
  auth: { user: 'user', pass: 'pass' },
};

describe('MailSenderService transporter pooling', () => {
  let service: MailSenderService;

  const createService = () => {
    const mailService = {
      templateAdapter: {},
      initTemplateAdapter: vi.fn(),
    } as unknown as MailerService;
    const mailConfig = {
      host: '',
      port: 465,
      secure: true,
      auth: { user: '', pass: '' },
      sender: '',
      senderName: '',
      isConfigured: false,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      dnsTimeout: 5000,
    } as unknown as IMailConfig;
    // Only the constructor-read fields and pooling collaborators matter for these tests
    const stub = <T>() => ({}) as T;
    return new MailSenderService(mailService, mailConfig, stub(), stub(), stub(), stub(), stub());
  };

  const createMockTransporter = () => ({
    sendMail: vi.fn().mockResolvedValue({ messageId: 'msg-id' }),
    close: vi.fn(),
  });

  beforeEach(() => {
    mockedCreateTransport.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedCreateTransport.mockImplementation(() => createMockTransporter() as any);
    service = createService();
  });

  it('reuses the same transporter for the same config', async () => {
    await service.sendMailByConfig({ to: 'a@example.com' }, smtpConfig);
    await service.sendMailByConfig({ to: 'b@example.com' }, smtpConfig);

    expect(mockedCreateTransport).toHaveBeenCalledTimes(1);
    expect(mockedCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ pool: true, host: smtpConfig.host })
    );
  });

  it('creates a new transporter when connection config changes', async () => {
    await service.sendMailByConfig({ to: 'a@example.com' }, smtpConfig);
    await service.sendMailByConfig(
      { to: 'a@example.com' },
      { ...smtpConfig, auth: { user: 'user', pass: 'new-pass' } }
    );

    expect(mockedCreateTransport).toHaveBeenCalledTimes(2);
  });

  it('does not share a transporter between omitted secure and explicit secure: false', async () => {
    // On port 465 nodemailer treats omitted secure as implicit TLS but explicit false as STARTTLS
    await service.sendMailByConfig({ to: 'a@example.com' }, { ...smtpConfig, secure: undefined });
    await service.sendMailByConfig({ to: 'a@example.com' }, { ...smtpConfig, secure: false });

    expect(mockedCreateTransport).toHaveBeenCalledTimes(2);
  });

  it('shares the transporter across configs differing only by sender fields', async () => {
    await service.sendMailByConfig({ to: 'a@example.com' }, smtpConfig);
    await service.sendMailByConfig(
      { to: 'a@example.com' },
      { ...smtpConfig, sender: 'other@example.com', senderName: 'Other' }
    );

    expect(mockedCreateTransport).toHaveBeenCalledTimes(1);
  });

  it('keeps the pooled transporter when a send fails', async () => {
    const transporter = createMockTransporter();
    transporter.sendMail
      .mockRejectedValueOnce(new Error('550 recipient rejected'))
      .mockResolvedValueOnce({ messageId: 'msg-id' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedCreateTransport.mockImplementationOnce(() => transporter as any);

    await expect(service.sendMailByConfig({ to: 'a@example.com' }, smtpConfig)).rejects.toThrow(
      '550 recipient rejected'
    );
    expect(transporter.close).not.toHaveBeenCalled();

    await service.sendMailByConfig({ to: 'b@example.com' }, smtpConfig);
    expect(mockedCreateTransport).toHaveBeenCalledTimes(1);
    expect(transporter.sendMail).toHaveBeenCalledTimes(2);
  });

  it('defers closing an evicted transporter until in-flight sends settle', async () => {
    const transporter = createMockTransporter();
    let resolveSend!: (value: { messageId: string }) => void;
    transporter.sendMail.mockImplementation(
      () => new Promise((resolve) => (resolveSend = resolve))
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedCreateTransport.mockImplementation(() => transporter as any);

    const pending = service.sendMailByConfig({ to: 'a@example.com' }, smtpConfig);
    await vi.waitFor(() => expect(transporter.sendMail).toHaveBeenCalled());

    service.onModuleDestroy();
    expect(transporter.close).not.toHaveBeenCalled();

    resolveSend({ messageId: 'msg-id' });
    await pending;
    expect(transporter.close).toHaveBeenCalledTimes(1);
  });

  it('does not close a transporter LRU-evicted between acquisition and its first send', async () => {
    // Real nodemailer hangs on a closed pool; reject instead so the failure is observable
    const transporters: { sendMail: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] =
      [];
    mockedCreateTransport.mockImplementation(() => {
      let closed = false;
      const t = {
        sendMail: vi.fn(() =>
          closed
            ? Promise.reject(new Error('Connection pool was closed'))
            : Promise.resolve({ messageId: 'msg-id' })
        ),
        close: vi.fn(() => {
          closed = true;
        }),
      };
      transporters.push(t);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return t as any;
    });

    // 51 distinct configs: the 51st set() LRU-evicts the first entry before its send runs
    const results = await Promise.all(
      Array.from({ length: 51 }, (_, i) =>
        service.sendMailByConfig(
          { to: `user${i}@example.com` },
          { ...smtpConfig, auth: { user: `user-${i}`, pass: 'pass' } }
        )
      )
    );

    expect(results).toHaveLength(51);
    expect(transporters[0].sendMail).toHaveBeenCalledTimes(1);
    expect(transporters[0].close).toHaveBeenCalledTimes(1);
  });

  it('closes all pooled transporters on module destroy', async () => {
    const transporter = createMockTransporter();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedCreateTransport.mockImplementation(() => transporter as any);
    await service.sendMailByConfig({ to: 'a@example.com' }, smtpConfig);

    service.onModuleDestroy();
    expect(transporter.close).toHaveBeenCalled();
  });

  it('does not cache and still closes a transporter created while destroy raced the miss', async () => {
    const transporter = createMockTransporter();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedCreateTransport.mockImplementation(() => transporter as any);

    const pending = service.sendMailByConfig({ to: 'a@example.com' }, smtpConfig);
    service.onModuleDestroy();

    await expect(pending).resolves.toEqual({ messageId: 'msg-id' });
    expect(transporter.close).toHaveBeenCalledTimes(1);

    await service.sendMailByConfig({ to: 'b@example.com' }, smtpConfig);
    expect(mockedCreateTransport).toHaveBeenCalledTimes(2);
  });
});
