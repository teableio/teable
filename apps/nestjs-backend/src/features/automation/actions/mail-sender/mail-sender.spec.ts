import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { generateWorkflowActionId } from '@teable-group/core';
import loadConfig from '../../../../configs/config';
import { MailSenderService } from '../../../mail-sender/mail-sender.service';
import { AutomationModule } from '../../automation.module';
import { JsonRulesEngine } from '../../engine/json-rules-engine';
import { ActionTypeEnums } from '../../enums/action-type.enum';
import type { IMailSenderSchema } from './mail-sender';

jest.setTimeout(100000000);

describe('Mail-Sender Action Test', () => {
  let jsonRulesEngine: JsonRulesEngine;
  let mailSenderService: MailSenderService;

  beforeAll(async () => {
    console.log(loadConfig);
    const moduleRef = await Test.createTestingModule({
      imports: [AutomationModule, EventEmitterModule.forRoot()],
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: () => loadConfig().mail,
      })
      .compile();

    moduleRef.useLogger(new ConsoleLogger());

    jsonRulesEngine = await moduleRef.resolve<JsonRulesEngine>(JsonRulesEngine);
    mailSenderService = await moduleRef.resolve<MailSenderService>(MailSenderService);

    jest
      .spyOn(mailSenderService, 'sendMail')
      .mockImplementation((_mailOptions) => Promise.resolve(true));
  });

  it('should call onSuccess and send mail', async () => {
    const actionId = generateWorkflowActionId();
    jsonRulesEngine.addRule(actionId, ActionTypeEnums.MailSender, {
      inputSchema: {
        to: {
          type: 'array',
          elements: [
            {
              type: 'template',
              elements: [
                {
                  type: 'const',
                  value: 'penganpingprivte@gmail.com',
                },
              ],
            },
          ],
        },
        subject: {
          type: 'template',
          elements: [
            {
              type: 'const',
              value: 'A test email from `table`',
            },
          ],
        },
        message: {
          type: 'template',
          elements: [
            {
              type: 'const',
              value: `first row\n1 <br>br\nsss
# h1 Heading 8-)
## h2 Heading
### h3 Heading
#### h4 Heading
##### h5 Heading
###### h6 Heading

---

[Click me](javascript:alert('XSS'))

---

<div>
  hello <script>alert('XSS');</script>
</div>

              `,
            },
          ],
        },
      } as IMailSenderSchema,
    });

    const { results } = await jsonRulesEngine.fire();

    expect(results).toBeDefined();

    const [result] = results;

    expect(result.result).toBeTruthy();
  });
});
