import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import type { OpenAIProvider } from '@ai-sdk/openai';
import { Injectable, Logger } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ISetSettingMailTransportConfigRo,
  IChatModelAbility,
  IAbilityDetail,
  ISettingVo,
  ITestLLMRo,
  ITestLLMVo,
  IBatchTestLLMRo,
  IBatchTestLLMVo,
  IModelTestResult,
  LLMProvider,
} from '@teable/openapi';
import { chatModelAbilityType, UploadType, LLMProviderType } from '@teable/openapi';
import { generateText, tool, experimental_generateImage } from 'ai';
import type { LanguageModel, TextPart, FilePart } from 'ai';
import { uniq } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { z } from 'zod';
import { BaseConfig, IBaseConfig } from '../../../configs/base.config';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import { getAdaptedProviderOptions, modelProviders } from '../../ai/util';
import { AttachmentsStorageService } from '../../attachments/attachments-storage.service';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';
import { getPublicFullStorageUrl } from '../../attachments/plugins/utils';
import { verifyTransport } from '../../mail-sender/mail-helpers';
import { SettingService } from '../setting.service';

const unknownErrorMsg = 'unknown error';

// Test file tokens from builtin-assets-init
const actTestImageToken = 'actTestImage';
const actTestPdfToken = 'actTestPDF';
// Test file paths
const testImagePath = 'static/test/test-image.png';
const testPdfPath = 'static/test/test-pdf.pdf';
// Expected letter in test files
const expectedLetter = 'k';

@Injectable()
export class SettingOpenApiService {
  private readonly logger = new Logger(SettingOpenApiService.name);

  constructor(
    private readonly prismaService: PrismaService,
    @BaseConfig() private readonly baseConfig: IBaseConfig,
    @InjectStorageAdapter() readonly storageAdapter: StorageAdapter,
    private readonly cls: ClsService<IClsStore>,
    private readonly settingService: SettingService,
    protected readonly attachmentsStorageService: AttachmentsStorageService
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

  /**
   * Test attachment support with a specific data source (URL or base64)
   */
  private async testAttachmentWithData(
    modelInstance: LanguageModel,
    data: string,
    contentType: string
  ): Promise<boolean> {
    const testPrompt =
      'What letter or character do you see in this file? Please respond with just the letter.';

    try {
      const textPart: TextPart = {
        type: 'text',
        text: testPrompt,
      };

      const filePart: FilePart = {
        type: 'file' as const,
        data,
        mediaType: contentType,
      };

      const res = await generateText({
        model: modelInstance,
        messages: [
          {
            role: 'user',
            content: [textPart, filePart],
          },
        ],
        temperature: 0,
      });

      // Check if AI response contains the expected letter (case insensitive)
      const responseText = res.text.toLowerCase();
      const containsExpected = responseText.includes(expectedLetter);

      this.logger.log(
        `testAttachment result: response="${res.text}", expected="${expectedLetter}", contains=${containsExpected}`
      );
      return containsExpected;
    } catch (error) {
      this.logger.error(
        `testAttachment error: ${error instanceof Error ? error.message : unknownErrorMsg}`
      );
      return false;
    }
  }

  /**
   * Get signed URL for a test file
   */
  private async getTestFileSignedUrl(token: string): Promise<string | null> {
    try {
      const bucket = StorageAdapter.getBucket(UploadType.ChatFile);
      const url = await this.attachmentsStorageService.getPreviewUrl(bucket, token);
      return url || null;
    } catch (error) {
      this.logger.error(`Failed to get signed URL for ${token}: ${error}`);
      return null;
    }
  }

  /**
   * Get base64 data URL for a test file
   */
  private async getTestFileBase64(filePath: string, contentType: string): Promise<string | null> {
    try {
      const fullPath = resolve(process.cwd(), filePath);
      const fileBuffer = await readFile(fullPath);
      const base64 = fileBuffer.toString('base64');
      return `data:${contentType};base64,${base64}`;
    } catch (error) {
      this.logger.error(`Failed to read file for base64 ${filePath}: ${error}`);
      return null;
    }
  }

  /**
   * Test image or PDF support with both URL and base64 forms in parallel
   * Returns detailed support info: { url: boolean, base64: boolean }
   */
  private async testAttachmentAbility(
    modelInstance: LanguageModel,
    token: string,
    filePath: string,
    contentType: string
  ): Promise<IAbilityDetail> {
    // Get both data sources in parallel
    const [signedUrl, base64Data] = await Promise.all([
      this.getTestFileSignedUrl(token),
      this.getTestFileBase64(filePath, contentType),
    ]);

    // Run both tests in parallel
    const [urlResult, base64Result] = await Promise.all([
      signedUrl
        ? this.testAttachmentWithData(modelInstance, signedUrl, contentType).then((r) => {
            this.logger.log(`testAttachmentAbility URL test for ${token}: ${r}`);
            return r;
          })
        : Promise.resolve(false),
      base64Data
        ? this.testAttachmentWithData(modelInstance, base64Data, contentType).then((r) => {
            this.logger.log(`testAttachmentAbility base64 test for ${token}: ${r}`);
            return r;
          })
        : Promise.resolve(false),
    ]);

    return { url: urlResult, base64: base64Result };
  }

  private async testToolCall(modelInstance: LanguageModel): Promise<boolean> {
    try {
      // Define tools inline with generateText for proper type inference
      const result = await generateText({
        model: modelInstance,
        prompt: 'What is the weather in Tokyo? Please use the available tool.',
        tools: {
          get_weather: tool({
            description: 'Get the current weather for a location',
            inputSchema: z.object({
              location: z.string().describe('The city name'),
            }),
            execute: async ({ location }) => `Weather in ${location}: Sunny, 25°C`,
          }),
        },
      });

      // Check multiple ways to detect tool calls
      // 1. Check toolCalls directly on result
      const hasDirectToolCall = result.toolCalls && result.toolCalls.length > 0;
      // 2. Check steps for tool calls
      const hasStepToolCall = result.steps?.some(
        (step) => step.toolCalls && step.toolCalls.length > 0
      );
      // 3. Check toolResults
      const hasToolResults = result.toolResults && result.toolResults.length > 0;

      const hasToolCall = hasDirectToolCall || hasStepToolCall || hasToolResults;

      this.logger.log(
        `testToolCall result: hasDirectToolCall=${hasDirectToolCall}, hasStepToolCall=${hasStepToolCall}, hasToolResults=${hasToolResults}`
      );
      return hasToolCall;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : unknownErrorMsg;
      this.logger.error(`testToolCall error: ${errorMessage}`);

      // Any error during tool call test means the model cannot properly use tools
      // Even schema errors indicate the model/provider combination is not usable for tool calling
      this.logger.log('testToolCall: Error during test, marking as unsupported');
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
    const result: IChatModelAbility = {};

    // Run all tests in parallel for better performance
    const testPromises: Promise<void>[] = [];

    if (testAbilities.includes(chatModelAbilityType.enum.image)) {
      testPromises.push(
        this.testAttachmentAbility(
          modelInstance,
          actTestImageToken,
          testImagePath,
          'image/png'
        ).then((detail) => {
          // Store detailed result - at least one form should work
          result.image = detail;
        })
      );
    }

    if (testAbilities.includes(chatModelAbilityType.enum.pdf)) {
      testPromises.push(
        this.testAttachmentAbility(
          modelInstance,
          actTestPdfToken,
          testPdfPath,
          'application/pdf'
        ).then((detail) => {
          // Store detailed result - at least one form should work
          result.pdf = detail;
        })
      );
    }

    if (testAbilities.includes(chatModelAbilityType.enum.toolCall)) {
      testPromises.push(
        this.testToolCall(modelInstance).then((supported) => {
          result.toolCall = supported;
        })
      );
    }

    // Wait for all tests to complete
    await Promise.all(testPromises);

    return result;
  }

  private parseModelKey(modelKey: string) {
    const [type, model, name] = modelKey.split('@');
    return { type, model, name };
  }

  async testLLM(testLLMRo: ITestLLMRo): Promise<ITestLLMVo> {
    const {
      type,
      baseUrl,
      apiKey,
      models,
      ability,
      modelKey,
      testImageGeneration,
      testImageToImage,
    } = testLLMRo;

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

      // Handle image generation model testing
      if (testImageGeneration) {
        return await this.testImageGenerationModel(modelProvider, model, type, testImageToImage);
      }

      // Standard text model testing
      const testPrompt = 'Hello, please respond with "Connection successful!"';
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
      const message = error instanceof Error ? error.message : unknownErrorMsg;
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

  private async testImageGenerationModel(
    modelProvider: OpenAIProvider,
    model: string,
    providerType: LLMProviderType,
    testImageToImage?: boolean
  ): Promise<ITestLLMVo> {
    try {
      // Google Gemini native image generation models use generateText with responseModalities
      if (providerType === LLMProviderType.GOOGLE) {
        return await this.testGoogleImageGeneration(modelProvider, model, testImageToImage);
      }

      // OpenAI-style image generation (DALL-E, etc.)

      const imageModel = modelProvider.image(model);

      if (testImageToImage) {
        // Test image-to-image: provide an image as input
        // Note: Not all image models support this, so we catch errors gracefully
        const testImageUrl =
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        await experimental_generateImage({
          model: imageModel,
          prompt: 'A simple test image',
          n: 1,
          size: '256x256',
          providerOptions: {
            openai: {
              image: testImageUrl,
            },
          },
        });
      } else {
        // Test basic text-to-image generation
        await experimental_generateImage({
          model: imageModel,
          prompt: 'A simple test: draw a small red circle',
          n: 1,
          size: '256x256',
        });
      }

      return {
        success: true,
        response: testImageToImage
          ? 'Image-to-image generation successful'
          : 'Image generation successful',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image generation failed';
      return {
        success: false,
        response: message,
      };
    }
  }

  /**
   * Test Google Gemini native image generation models
   * These models use generateText with responseModalities: ['TEXT', 'IMAGE']
   */
  private async testGoogleImageGeneration(
    modelProvider: OpenAIProvider,
    model: string,
    testImageToImage?: boolean
  ): Promise<ITestLLMVo> {
    try {
      const modelInstance = modelProvider(model) as unknown as LanguageModel;

      if (testImageToImage) {
        // Test image-to-image with a simple 1x1 pixel image
        const testImageBase64 =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

        const result = await generateText({
          model: modelInstance,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  image: `data:image/png;base64,${testImageBase64}`,
                },
                {
                  type: 'text',
                  text: 'Generate a variation of this image with a red circle',
                },
              ],
            },
          ],
          providerOptions: {
            google: {
              responseModalities: ['TEXT', 'IMAGE'],
            },
          },
        });

        // Check if we got any response (text or image parts)
        if (result.text || result.response) {
          return {
            success: true,
            response: 'Image-to-image generation successful',
          };
        }
      } else {
        // Test text-to-image generation
        const result = await generateText({
          model: modelInstance,
          prompt: 'Generate an image of a simple red circle on white background',
          providerOptions: {
            google: {
              responseModalities: ['TEXT', 'IMAGE'],
            },
          },
        });

        // Check if we got any response
        if (result.text || result.response) {
          return {
            success: true,
            response: 'Image generation successful',
          };
        }
      }

      return {
        success: false,
        response: 'No image generated',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image generation failed';
      return {
        success: false,
        response: message,
      };
    }
  }

  async setMailTransportConfig(setMailTransportConfigRo: ISetSettingMailTransportConfigRo) {
    const { name, transportConfig } = setMailTransportConfigRo;
    await verifyTransport(transportConfig);
    await this.settingService.updateSetting({
      [name]: transportConfig,
    });
  }

  /**
   * Test a single model and return the result
   * This is a non-throwing version for batch testing
   */
  private async testSingleModel(
    provider: Required<LLMProvider>,
    model: string
  ): Promise<IModelTestResult> {
    const { type, name: providerName, baseUrl, apiKey } = provider;
    const modelKey = `${type}@${model}@${providerName}`;
    const testPrompt = 'Hello, please respond with "Connection successful!"';

    try {
      const providerFactory = modelProviders[type];

      if (!providerFactory) {
        return {
          modelKey,
          providerName,
          providerType: type,
          model,
          success: false,
          error: `Unsupported provider type: ${type}`,
        };
      }

      const providerOptions = getAdaptedProviderOptions(type, {
        name: model,
        baseURL: baseUrl,
        apiKey,
      });
      const modelProvider = providerFactory({
        ...providerOptions,
      }) as OpenAIProvider;
      const modelInstance = modelProvider(model) as unknown as LanguageModel;

      // Test basic generation
      await generateText({
        model: modelInstance,
        prompt: testPrompt,
        temperature: 1,
      });

      // Test image support (vision capability)
      const ability = await this.testChatModelAbility(modelInstance, [
        chatModelAbilityType.enum.image,
      ]);

      return {
        modelKey,
        providerName,
        providerType: type,
        model,
        success: true,
        ability,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : unknownErrorMsg;
      this.logger.error(`Batch test failed for model ${modelKey}: ${errorMessage}`);

      return {
        modelKey,
        providerName,
        providerType: type,
        model,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Batch test all configured LLM models
   * Tests basic generation and image (attachment) support for each model
   */
  async batchTestLLM(batchTestLLMRo?: IBatchTestLLMRo): Promise<IBatchTestLLMVo> {
    // Get providers from request or from settings
    let providers: LLMProvider[];

    if (batchTestLLMRo?.providers && batchTestLLMRo.providers.length > 0) {
      providers = batchTestLLMRo.providers;
    } else {
      const setting = await this.getSetting();
      providers = setting.aiConfig?.llmProviders ?? [];
    }

    if (providers.length === 0) {
      return {
        totalModels: 0,
        testedModels: 0,
        successCount: 0,
        failedCount: 0,
        results: [],
      };
    }

    // Expand all models from all providers
    const modelTests: { provider: Required<LLMProvider>; model: string }[] = [];

    for (const provider of providers) {
      if (!provider.apiKey || !provider.baseUrl || !provider.models) {
        continue;
      }

      const models = provider.models
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean);
      for (const model of models) {
        modelTests.push({
          provider: provider as Required<LLMProvider>,
          model,
        });
      }
    }

    const totalModels = modelTests.length;

    if (totalModels === 0) {
      return {
        totalModels: 0,
        testedModels: 0,
        successCount: 0,
        failedCount: 0,
        results: [],
      };
    }

    // Run all tests in parallel with concurrency limit
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const CONCURRENCY_LIMIT = 5;
    const results: IModelTestResult[] = [];

    for (let i = 0; i < modelTests.length; i += CONCURRENCY_LIMIT) {
      const batch = modelTests.slice(i, i + CONCURRENCY_LIMIT);
      const batchResults = await Promise.all(
        batch.map(({ provider, model }) => this.testSingleModel(provider, model))
      );
      results.push(...batchResults);
    }

    const successCount = results.filter((r) => r.success).length;
    const failedCount = results.filter((r) => !r.success).length;

    return {
      totalModels,
      testedModels: results.length,
      successCount,
      failedCount,
      results,
    };
  }
}
