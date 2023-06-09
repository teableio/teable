import { ConfigModule } from '@nestjs/config';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import loadConfig from 'src/configs/config';
import { MailSenderService } from './mail-sender.service';

jest.setTimeout(100000000);
describe('MailSenderService', () => {
  let service: MailSenderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: [loadConfig],
        }),
      ],
      providers: [MailSenderService],
    }).compile();

    service = module.get<MailSenderService>(MailSenderService);
  });

  it('should be defined', async () => {
    expect(service).toBeDefined();
  });

  it('send a plain text test email', async () => {
    expect(service).toBeDefined();

    const mailOptions = {
      to: 'penganping_ping@163.com',
      subject: `Test email from 'trable'`,
      text: `hello trable, hello world`,
    };

    const sendResult = await service.sendMail(mailOptions);

    expect(sendResult).toBeTruthy();
  });
});
