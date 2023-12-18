/* eslint-disable @typescript-eslint/naming-convention */
import path from 'path';
import type { DynamicModule } from '@nestjs/common';
import { ConfigurableModuleBuilder, Logger, Module } from '@nestjs/common';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import type { IMailConfig } from '../../configs/mail.config';
import { mailConfig } from '../../configs/mail.config';
import { MailSenderService } from './mail-sender.service';

export interface MailSenderModuleOptions {
  global?: boolean;
}

export const { ConfigurableModuleClass: MailSenderModuleClass, OPTIONS_TYPE } =
  new ConfigurableModuleBuilder<MailSenderModuleOptions>().build();

@Module({})
export class MailSenderModule extends MailSenderModuleClass {
  static register(options?: typeof OPTIONS_TYPE): DynamicModule {
    const logger = new Logger();
    const { global } = options || {};

    const module = MailerModule.forRootAsync({
      inject: [mailConfig.KEY],
      useFactory: (config: IMailConfig) => {
        const templateDir = path.join(__dirname, '/templates');

        logger.log(`[Mail Template Dir]: ${templateDir}`);
        return {
          transport: {
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: {
              user: config.auth.user,
              pass: config.auth.pass,
            },
          },
          defaults: {
            from: `"${config.senderName}" <${config.sender}>`,
          },
          template: {
            dir: templateDir,
            adapter: new HandlebarsAdapter(),
            options: {
              strict: true,
            },
          },
        };
      },
    });

    return {
      imports: [module],
      module: MailSenderModule,
      global,
      providers: [MailSenderService, Logger],
      exports: [MailSenderService],
    };
  }
}
