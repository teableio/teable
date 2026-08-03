/* eslint-disable @typescript-eslint/naming-convention */
import path from 'path';
import type { DynamicModule } from '@nestjs/common';
import { ConfigurableModuleBuilder, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { createTransport } from 'nodemailer';
import type { IMailConfig } from '../../configs/mail.config';
import { SettingOpenApiModule } from '../setting/open-api/setting-open-api.module';
import { buildEmailFrom, helpers } from './mail-helpers';
import { MailSenderService } from './mail-sender.service';

export interface MailSenderModuleOptions {
  global?: boolean;
}

export const { ConfigurableModuleClass: MailSenderModuleClass, OPTIONS_TYPE } =
  new ConfigurableModuleBuilder<MailSenderModuleOptions>().build();

/**
 * Create a no-op transport for when mail is not configured.
 * This transport logs emails instead of sending them and has a proper verify() method
 * that returns a Promise (required by @nestjs-modules/mailer).
 */
function createNoOpTransport() {
  const transport = createTransport({
    jsonTransport: true,
  });

  // Override verify to return a Promise (the original returns false for jsonTransport)
  // This is needed because @nestjs-modules/mailer calls verify().then() without checking
  const originalVerify = transport.verify.bind(transport);
  transport.verify = function (callback?: (err: Error | null, success: boolean) => void) {
    if (callback) {
      return originalVerify(callback);
    }
    return Promise.resolve(true);
  } as typeof transport.verify;

  return transport;
}

@Module({})
export class MailSenderModule extends MailSenderModuleClass {
  static register(): DynamicModule {
    const module = MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const mailConfig = config.getOrThrow<IMailConfig>('mail');
        const templatePagesDir = path.join(__dirname, '/templates/pages');
        const templatePartialsDir = path.join(__dirname, '/templates/partials');

        Logger.log(`[Mail Template Pages Dir]: ${templatePagesDir}`);
        Logger.log(`[Mail Template Partials Dir]: ${templatePartialsDir}`);

        // If mail is not configured, use a no-op transport that logs instead of sending
        // and has a proper verify() method that returns a Promise
        const transport = mailConfig.isConfigured
          ? {
              host: mailConfig.host,
              port: mailConfig.port,
              secure: mailConfig.secure,
              auth: {
                user: mailConfig.auth.user,
                pass: mailConfig.auth.pass,
              },
            }
          : createNoOpTransport();

        if (!mailConfig.isConfigured) {
          Logger.warn(
            '[MailSenderModule] Mail is not configured. Emails will be logged instead of sent.',
            'MailSenderModule'
          );
        }

        return {
          transport,
          defaults: {
            from: buildEmailFrom(mailConfig.sender, mailConfig.senderName),
          },
          template: {
            dir: templatePagesDir,
            adapter: new HandlebarsAdapter(helpers(config)),
            options: {
              strict: true,
            },
          },
          options: {
            partials: {
              dir: templatePartialsDir,
              options: {
                strict: true,
              },
            },
          },
        };
      },
    });

    return {
      imports: [SettingOpenApiModule, module],
      module: MailSenderModule,
      providers: [MailSenderService],
      exports: [MailSenderService],
    };
  }
}
