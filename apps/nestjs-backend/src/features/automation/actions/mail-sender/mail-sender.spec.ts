import { Test } from '@nestjs/testing';
import { generateWorkflowActionId } from '@teable/core';
import { vi } from 'vitest';
import { GlobalModule } from '../../../../global/global.module';
import { MailSenderService } from '../../../mail-sender/mail-sender.service';
import { AutomationModule } from '../../automation.module';
import { JsonRulesEngine } from '../../engine/json-rules-engine';
import { ActionTypeEnums } from '../../enums/action-type.enum';
import type { IMailSenderSchema } from './mail-sender';

describe('Mail-Sender Action Test', () => {
  let jsonRulesEngine: JsonRulesEngine;
  let mailSenderService: MailSenderService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GlobalModule, AutomationModule],
    }).compile();

    jsonRulesEngine = await moduleRef.resolve<JsonRulesEngine>(JsonRulesEngine);
    mailSenderService = await moduleRef.resolve<MailSenderService>(MailSenderService);

    vi.spyOn(mailSenderService, 'sendMail').mockImplementation((_mailOptions) =>
      Promise.resolve(true)
    );
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
