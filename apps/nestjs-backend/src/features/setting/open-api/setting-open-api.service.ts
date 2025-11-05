import { join } from 'path';
import type { OpenAIProvider } from '@ai-sdk/openai';
import { Injectable, Logger } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ISetSettingMailTransportConfigRo,
  IChatModelAbility,
  IChatModelAbilityType,
  ISettingVo,
  ITestLLMRo,
  ITestLLMVo,
} from '@teable/openapi';
import { chatModelAbilityType, UploadType } from '@teable/openapi';
import { generateText } from 'ai';
import type { LanguageModel, TextPart, FilePart } from 'ai';
import { uniq } from 'lodash';

// Attachment type for AI SDK 5.0
type IAttachment = {
  url: string;
  contentType?: string;
  name?: string;
};
import { ClsService } from 'nestjs-cls';
import { BaseConfig, IBaseConfig } from '../../../configs/base.config';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import { getAdaptedProviderOptions, modelProviders } from '../../ai/util';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';
import { getPublicFullStorageUrl } from '../../attachments/plugins/utils';
import { verifyTransport } from '../../mail-sender/mail-helpers';
import { SettingService } from '../setting.service';
import { getEmptyImageDataURL, getEmptyPDFDataURL } from './utils';

@Injectable()
export class SettingOpenApiService {
  private readonly logger = new Logger(SettingOpenApiService.name);

  constructor(
    private readonly prismaService: PrismaService,
    @BaseConfig() private readonly baseConfig: IBaseConfig,
    @InjectStorageAdapter() readonly storageAdapter: StorageAdapter,
    private readonly cls: ClsService<IClsStore>,
    private readonly settingService: SettingService
  ) {}

  async getSetting(names?: string[]): Promise<ISettingVo> {
    return this.settingService.getSetting(names);
  }

  async updateSetting(updateSettingRo: Partial<ISettingVo>): Promise<ISettingVo> {
    return this.settingService.updateSetting(updateSettingRo);
  }

  async getServerBrand(): Promise<{ brandName: string; brandLogo: string }> {
    return {
      brandName: 'Teable',
      brandLogo: `${this.baseConfig.publicOrigin}/images/favicon/apple-touch-icon.png`,
    };
  }

  async uploadLogo(file: Express.Multer.File) {
    const token = 'brand';
    const path = join(StorageAdapter.getDir(UploadType.Logo), 'brand');
    const bucket = StorageAdapter.getBucket(UploadType.Logo);

    const { hash } = await this.storageAdapter.uploadFileWidthPath(bucket, path, file.path, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': file.mimetype,
    });

    const { size, mimetype } = file;
    const userId = this.cls.get('user.id');

    await this.prismaService.txClient().attachments.upsert({
      create: {
        hash,
        size,
        mimetype,
        token,
        path,
        createdBy: userId,
      },
      update: {
        hash,
        size,
        mimetype,
        path,
      },
      where: {
        token,
        deletedTime: null,
      },
    });

    await this.updateSetting({ brandLogo: path });

    return {
      url: getPublicFullStorageUrl(path),
    };
  }

  private async testAttachments(modelInstance: LanguageModel, attachments: IAttachment[]) {
    if (!attachments?.length) {
      return undefined;
    }

    const testPrompt = 'Hello, please respond with "Connection successful!"';

    try {
      const textPart: TextPart = {
        type: 'text',
        text: testPrompt,
      };

      const fileParts: FilePart[] = attachments.map((attachment) => ({
        type: 'file' as const,
        data: attachment.url,
        mediaType: attachment.contentType || 'application/octet-stream',
      }));

      const res = await generateText({
        model: modelInstance,
        messages: [
          {
            role: 'user',
            content: [textPart, ...fileParts],
          },
        ],
        temperature: 1,
      });
      this.logger.log(`testAttachments success, attachments: ${res.text}`);
      return true;
    } catch (error) {
      this.logger.error(
        `testAttachments error ${error instanceof Error ? error.message : 'unknown error'}`
      );
      return false;
    }
  }

  private async testChatModelAbility(
    modelInstance: LanguageModel,
    ability: ITestLLMRo['ability']
  ): Promise<IChatModelAbility> {
    if (!ability?.length) {
      return {};
    }

    const testAbilities = uniq(ability);
    const supportAbilities: ITestLLMRo['ability'] = [];

    if (testAbilities.includes(chatModelAbilityType.enum.image)) {
      const supportImage = await this.testAttachments(modelInstance, [
        {
          url: getEmptyImageDataURL(),
          contentType: 'image/png',
          name: 'test.png',
        },
      ]);
      if (supportImage) {
        supportAbilities.push(chatModelAbilityType.enum.image);
      }
    }
    if (testAbilities.includes(chatModelAbilityType.enum.pdf)) {
      const supportPDF = await this.testAttachments(modelInstance, [
        {
          url: getEmptyPDFDataURL(),
          contentType: 'application/pdf',
          name: 'test.pdf',
        },
      ]);
      if (supportPDF) {
        supportAbilities.push(chatModelAbilityType.enum.pdf);
      }
    }

    return supportAbilities?.reduce(
      (acc, curr) => {
        acc[curr] = true;
        return acc;
      },
      {} as Record<IChatModelAbilityType, boolean>
    );
  }

  private parseModelKey(modelKey: string) {
    const [type, model, name] = modelKey.split('@');
    return { type, model, name };
  }

  async testLLM(testLLMRo: ITestLLMRo): Promise<ITestLLMVo> {
    const { type, baseUrl, apiKey, models, ability, modelKey } = testLLMRo;
    const testPrompt = 'Hello, please respond with "Connection successful!"';
    try {
      const modelArray = models.split(',');
      const model = modelKey ? this.parseModelKey(modelKey).model : modelArray[0];

      const provider = modelProviders[type];

      const providerOptions = getAdaptedProviderOptions(type, {
        name: model,
        baseURL: baseUrl,
        apiKey,
      });
      const modelProvider = provider({
        ...providerOptions,
      }) as OpenAIProvider;
      const modelInstance = modelProvider(model) as unknown as LanguageModel;
      const { text } = await generateText({
        model: modelInstance,
        prompt: testPrompt,
        temperature: 1,
      });
      const supportAbilities = await this.testChatModelAbility(modelInstance, ability);
      return {
        success: true,
        response: text,
        ability: supportAbilities,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new CustomHttpException(
        'LLM test failed with error: ' + message,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.ai.testLLMFailed',
          },
        }
      );
    }
  }

  async setMailTransportConfig(setMailTransportConfigRo: ISetSettingMailTransportConfigRo) {
    const { name, transportConfig } = setMailTransportConfigRo;
    await verifyTransport(transportConfig);
    await this.settingService.updateSetting({
      [name]: transportConfig,
    });
  }
}
