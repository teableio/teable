export enum ActionTypeEnums {
  Webhook = 'webhook',
  MailSender = 'mail_sender',
  CreateRecord = 'create_record',

  /**
   * to bind one or more `action`s to a conditional determiner of whether to continue execution；
   */
  Decision = 'decision',
}
