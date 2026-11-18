import { MailTransporterType, MailType } from '@teable/openapi';
import ms from 'ms';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCoalesceBackend } from '../../coalesce/coalesce.spec-mocks';
import { MailMergeGroup } from '../mail-helpers';
import { MailSenderMergeService } from './mail-sender.merge.service';

const TO = 'owner@example.com';

const alertMail = (subject: string) => ({
  to: TO,
  subject,
  mailType: MailType.System,
  mergeGroup: MailMergeGroup.FailureAlert,
});

const commentMail = (subject: string) => ({
  to: TO,
  subject,
  mailType: MailType.Common,
  mergeGroup: MailMergeGroup.Default,
});

function harness() {
  const mailSenderService = {
    sendMailByTransporterName: vi.fn().mockResolvedValue(true),
    notifyMergeOptions: vi.fn(async (list: { subject: string }[]) => ({
      subject: 'merged',
      context: { list },
    })),
  };
  const settingOpenApiService = {
    getServerBrand: vi.fn().mockResolvedValue({ brandName: 'Teable', brandLogo: '' }),
  };
  const service = new MailSenderMergeService(
    mailSenderService as never,
    settingOpenApiService as never,
    createCoalesceBackend().createService()
  );
  const run = (payload: unknown) => service.onNotifyMailMerge({ payload } as never);
  const sentSubjects = () =>
    mailSenderService.sendMailByTransporterName.mock.calls.map(([mail]) => mail.subject);
  return { run, sentSubjects, mailSenderService };
}

describe('MailSenderMergeService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends the first failure alert at once and the rest as one mail an hour later', async () => {
    const { run, sentSubjects, mailSenderService } = harness();

    await run(alertMail('Routine A failed'));
    await vi.advanceTimersByTimeAsync(ms('10m'));
    await run(alertMail('Routine B failed'));
    await vi.advanceTimersByTimeAsync(ms('30m'));
    await run(alertMail('Routine C failed'));
    expect(sentSubjects()).toEqual(['Routine A failed']);

    await vi.advanceTimersByTimeAsync(ms('20m'));
    expect(mailSenderService.notifyMergeOptions).toHaveBeenCalledWith(
      [
        expect.objectContaining({ subject: 'Routine B failed' }),
        expect.objectContaining({ subject: 'Routine C failed' }),
      ],
      'Teable',
      ''
    );
    expect(sentSubjects()).toEqual(['Routine A failed', 'merged']);
    expect(mailSenderService.sendMailByTransporterName).toHaveBeenLastCalledWith(
      expect.objectContaining({ to: TO }),
      MailTransporterType.Notify,
      MailType.NotifyMerge
    );
  });

  it('sends what goes out without its merge group, so it is not merged again', async () => {
    const { run, mailSenderService } = harness();

    await run(alertMail('Routine A failed'));

    expect(mailSenderService.sendMailByTransporterName.mock.calls[0][0]).not.toHaveProperty(
      'mergeGroup'
    );
  });

  it('sends a lone held alert as it is', async () => {
    const { run, sentSubjects } = harness();

    await run(alertMail('Routine A failed'));
    await run(alertMail('Routine B failed'));
    await vi.advanceTimersByTimeAsync(ms('1h'));

    expect(sentSubjects()).toEqual(['Routine A failed', 'Routine B failed']);
  });

  it('logs a first mail that fails to send instead of throwing into the emitter', async () => {
    const { run, mailSenderService } = harness();
    mailSenderService.sendMailByTransporterName.mockRejectedValueOnce(new Error('smtp down'));

    await expect(run(alertMail('Routine A failed'))).resolves.toBeUndefined();
  });

  it('merges other notify mail on the one-minute window, apart from alerts', async () => {
    const { run, sentSubjects } = harness();

    await run(commentMail('New comment'));
    await run(alertMail('Routine A failed'));
    await run(commentMail('Another comment'));
    expect(sentSubjects()).toEqual(['New comment', 'Routine A failed']);

    await vi.advanceTimersByTimeAsync(ms('1m'));
    expect(sentSubjects()).toEqual(['New comment', 'Routine A failed', 'Another comment']);
  });
});
