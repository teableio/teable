import { Injectable, Scope } from '@nestjs/common';
import type { Almanac, Event, RuleResult } from 'json-rules-engine';
import { MailSenderService } from '../../../mail-sender/mail-sender.service';
import { JsonSchemaParser } from '../../engine/json-schema-parser.class';
import type { IActionResponse, IElementArraySchema, ITemplateSchema } from '../action-core';
import { actionConst, ActionCore, ActionResponseStatus } from '../action-core';

export interface IMailSenderSchema extends Record<string, unknown> {
  to: IElementArraySchema;
  cc?: IElementArraySchema;
  bcc?: IElementArraySchema;
  replyTo?: IElementArraySchema;
  subject: ITemplateSchema;
  message: ITemplateSchema;
}

@Injectable({ scope: Scope.REQUEST })
export class MailSender extends ActionCore {
  constructor(private readonly mailSenderService: MailSenderService) {
    super();
  }

  bindParams(id: string, params: IMailSenderSchema, priority?: number): this {
    return this.setName(id)
      .setEvent({ type: id, params: params })
      .setPriority(priority ? priority : 1);
  }

  onSuccess = async (event: Event, almanac: Almanac, _ruleResult: RuleResult): Promise<void> => {
    const jsonSchemaParser = new JsonSchemaParser(event.params as IMailSenderSchema, {
      pathResolver: async (_, path) => {
        const [id, p] = path;
        return await almanac.factValue(id, undefined, p);
      },
    });
    const { to, cc, bcc, replyTo, subject, message } = (await jsonSchemaParser.parse()) as {
      to: string;
      cc: string;
      bcc: string;
      replyTo: string;
      subject: string;
      message: string;
    };

    const mailOptions = { to, cc, bcc, replyTo, subject, html: message };

    let outPut: IActionResponse<unknown>;
    await this.mailSenderService
      .sendMail(mailOptions)
      .then((senderResult) => {
        outPut = { msg: 'ok', data: senderResult, code: ActionResponseStatus.Success };
      })
      .catch((error) => {
        outPut = { msg: 'error', data: undefined, code: ActionResponseStatus.ServerError };
      })
      .finally(() => {
        almanac.addRuntimeFact(`${this.name}${actionConst.OutPutFlag}`, outPut);
      });
  };
}
