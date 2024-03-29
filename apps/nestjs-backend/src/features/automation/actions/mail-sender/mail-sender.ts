import { Injectable, Logger, Scope } from '@nestjs/common';
import type { Almanac, Event, RuleResult } from 'json-rules-engine';
import MarkdownIt from 'markdown-it';
import { MailSenderService } from '../../../mail-sender/mail-sender.service';
import type { IActionResponse, IObjectArraySchema, ITemplateSchema } from '../action-core';
import { actionConst, ActionCore, ActionResponseStatus } from '../action-core';

export const markdownIt = MarkdownIt({
  html: true,
  breaks: true,
  // eslint-disable-next-line @typescript-eslint/no-var-requires
}).use(require('markdown-it-sanitizer'));

export interface IMailSenderSchema extends Record<string, unknown> {
  to: IObjectArraySchema;
  cc?: IObjectArraySchema;
  bcc?: IObjectArraySchema;
  replyTo?: IObjectArraySchema;
  subject: ITemplateSchema;
  message: ITemplateSchema;
}

export interface IMailSenderOptions {
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
  subject: string;
  message: string;
}

@Injectable({ scope: Scope.REQUEST })
export class MailSender extends ActionCore {
  private logger = new Logger(MailSender.name);

  constructor(private readonly mailSenderService: MailSenderService) {
    super();
  }

  bindParams(id: string, params: IMailSenderSchema, priority?: number): this {
    return this.setName(id).setEvent({ type: id, params: params }).setPriority(priority);
  }

  onSuccess = async (event: Event, almanac: Almanac, _ruleResult: RuleResult): Promise<void> => {
    const { to, cc, bcc, replyTo, subject, message } =
      await this.parseInputSchema<IMailSenderOptions>(event.params as IMailSenderSchema, almanac);

    const html = markdownIt.render(message);

    const mailOptions = { to, cc, bcc, replyTo, subject, html };

    let outPut: IActionResponse<unknown>;
    await this.mailSenderService
      .sendMail(mailOptions)
      .then((senderResult) => {
        outPut = { data: { senderResult }, status: ActionResponseStatus.OK };
      })
      .catch((error) => {
        this.logger.error(error.message, error?.stack);
        outPut = {
          error: error.message,
          data: undefined,
          status: ActionResponseStatus.InternalServerError,
        };
      })
      .finally(() => {
        almanac.addRuntimeFact(`${actionConst.OutPutFlag}${this.name}`, outPut);
      });
  };
}
