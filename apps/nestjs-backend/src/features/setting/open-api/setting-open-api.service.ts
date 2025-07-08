import { join } from 'path';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { ISettingVo, ITestLLMRo, ITestLLMVo } from '@teable/openapi';
import { LLMProviderType, UploadType } from '@teable/openapi';
import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import { ClsService } from 'nestjs-cls';
import { BaseConfig, IBaseConfig } from '../../../configs/base.config';
import type { IClsStore } from '../../../types/cls';
import { modelProviders } from '../../ai/util';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';
import { getPublicFullStorageUrl } from '../../attachments/plugins/utils';
import { SettingService } from '../setting.service';
@Injectable()
export class SettingOpenApiService {
  constructor(
    private readonly prismaService: PrismaService,
    @BaseConfig() private readonly baseConfig: IBaseConfig,
    @InjectStorageAdapter() readonly storageAdapter: StorageAdapter,
    private readonly cls: ClsService<IClsStore>,
    private readonly settingService: SettingService
  ) {}

  async getSetting(): Promise<ISettingVo> {
    return this.settingService.getSetting();
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

  async testLLM(testLLMRo: ITestLLMRo): Promise<ITestLLMVo> {
    const { type, baseUrl, apiKey, models } = testLLMRo;
    const testPrompt = 'Hello, please respond with "Connection successful!"';

    try {
      const model = models.split(',')[0].trim();
      const provider = modelProviders[type];
      const providerOptions =
        type === LLMProviderType.OLLAMA ? { baseURL: baseUrl } : { baseURL: baseUrl, apiKey };
      const modelProvider = provider(providerOptions);
      const modelInstance = modelProvider(model);
      const { text } = await generateText({
        model: modelInstance as LanguageModel,
        prompt: testPrompt,
      });

      return {
        success: true,
        response: text,
      };
    } catch (error) {
      return {
        success: false,
        response: error instanceof Error ? error.message : undefined,
      };
    }
  }
}
