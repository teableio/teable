/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
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
  IPublicSettingVo,
  ITestLLMRo,
  ITestLLMVo,
  IBatchTestLLMRo,
  IBatchTestLLMVo,
  IModelTestResult,
  LLMProvider,
  ITestApiKeyRo,
  ITestApiKeyVo,
  ITestPublicAccessVo,
  GatewayModelType,
  GatewayModelTag,
  GatewayModelProvider,
  IImageSize,
} from '@teable/openapi';
import {
  chatModelAbilityType,
  getImageModelConfig,
  getImageModelConfigByGatewayId,
  UploadType,
  LLMProviderType,
  SettingKey,
} from '@teable/openapi';
import { createGateway, generateText, tool, generateImage } from 'ai';
import type { LanguageModel, TextPart, FilePart } from 'ai';
import axios from 'axios';
import { uniq } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { z } from 'zod';
import { BaseConfig, IBaseConfig } from '../../../configs/base.config';
import { type IStorageConfig, StorageConfig } from '../../../configs/storage';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import { resolveBuildVersion } from '../../../utils/build-version';
import { INSTANCE_PROVIDER_NAME } from '../../ai/ai.service';
import { getAdaptedProviderOptions, modelProviders } from '../../ai/util';
import { AttachmentsStorageService } from '../../attachments/attachments-storage.service';
import StorageAdapter from '../../attachments/plugins/adapter';
import { InjectStorageAdapter } from '../../attachments/plugins/storage';
import { getPublicFullStorageUrl } from '../../attachments/plugins/utils';
import { EMAIL_LOGO_TOKEN } from '../../builtin-assets-init';
import { verifyTransport } from '../../mail-sender/mail-helpers';
import { SettingService } from '../setting.service';

const unknownErrorMsg = 'unknown error';

// Test file tokens from builtin-assets-init
const actTestImageToken = 'actTestImage';
const actTestPdfToken = 'actTestPDF';
// Test file paths
const testImagePath = 'static/test/test-image.png';
const testPdfPath = 'static/test/test-pdf.pdf';
// Expected letter in test files - use uppercase K for stricter matching
const expectedLetter = 'k';

@Injectable()
export class SettingOpenApiService {
  private readonly logger = new Logger(SettingOpenApiService.name);

  constructor(
    private readonly prismaService: PrismaService,
    @BaseConfig() private readonly baseConfig: IBaseConfig,
    @StorageConfig() private readonly storageConfig: IStorageConfig,
    @InjectStorageAdapter() readonly storageAdapter: StorageAdapter,
    private readonly cls: ClsService<IClsStore>,
    private readonly settingService: SettingService,
    protected readonly attachmentsStorageService: AttachmentsStorageService
  ) {}

  async getSetting(names?: string[]): Promise<ISettingVo> {
    return this.settingService.getSetting(names);
  }

  async updateSetting(updateSettingRo: Partial<ISettingVo>): Promise<ISettingVo> {
    // Instance providers must use "teable" as name so modelKeys end with @teable,
    // allowing a simple suffix check to distinguish instance vs BYOK models.
    if (updateSettingRo.aiConfig) {
      this.normalizeInstanceProviderNames(updateSettingRo.aiConfig as Record<string, unknown>);
    }
    return this.settingService.updateSetting(updateSettingRo);
  }

  /**
   * Rewrite all provider names to "teable" and update chatModel keys accordingly.
   * Admin-configured providers are always instance-level; the @teable suffix
   * lets the rest of the system distinguish them from BYOK (space-level) providers.
   */
  private normalizeInstanceProviderNames(aiConfig: Record<string, unknown>): void {
    const name = INSTANCE_PROVIDER_NAME;
    const providers = aiConfig.llmProviders as Array<Record<string, unknown>> | undefined;
    if (providers) {
      for (const provider of providers) {
        provider.name = name;
      }
    }
    const chatModel = aiConfig.chatModel as Record<string, string | undefined> | undefined;
    if (chatModel) {
      for (const tier of ['lg', 'md', 'sm']) {
        const key = chatModel[tier];
        if (key && key.includes('@')) {
          const parts = key.split('@');
          parts[parts.length - 1] = name;
          chatModel[tier] = parts.join('@');
        }
      }
    }
  }

  async getServerBrand(): Promise<{ brandName: string; brandLogo: string }> {
    const logoPath = join(StorageAdapter.getDir(UploadType.Logo), EMAIL_LOGO_TOKEN);
    return {
      brandName: 'Teable',
      brandLogo: getPublicFullStorageUrl(logoPath),
    };
  }

  /**
   * Returns the core public setting (without controller-only fields like turnstile/threshold).
   * Overridable in EE to append platform-specific providers (e.g. Slack from DB config).
   */
  async getPublicSetting(): Promise<
    Omit<
      IPublicSettingVo,
      | 'turnstileSiteKey'
      | 'changeEmailSendCodeMailRate'
      | 'resetPasswordSendMailRate'
      | 'signupVerificationSendCodeMailRate'
    >
  > {
    const setting = await this.getSetting([
      SettingKey.INSTANCE_ID,
      SettingKey.BRAND_NAME,
      SettingKey.BRAND_LOGO,
      SettingKey.DISALLOW_SIGN_UP,
      SettingKey.DISALLOW_SPACE_CREATION,
      SettingKey.DISALLOW_SPACE_INVITATION,
      SettingKey.DISALLOW_DASHBOARD,
      SettingKey.ENABLE_EMAIL_VERIFICATION,
      SettingKey.ENABLE_WAITLIST,
      SettingKey.ENABLE_CREDIT_REWARD,
      SettingKey.AI_CONFIG,
      SettingKey.APP_CONFIG,
    ]);
    const { aiConfig, appConfig, enableCreditReward, ...rest } = setting;

    const availableIntegrationProviders: string[] = [
      ...(process.env.GMAIL_CLIENT_ID ? ['gmail'] : []),
      ...(process.env.OUTLOOK_CLIENT_ID ? ['outlook'] : []),
    ];

    return {
      ...rest,
      enableCreditReward: enableCreditReward ?? undefined,
      aiConfig: {
        enable: Boolean(aiConfig?.chatModel?.lg),
        llmProviders:
          aiConfig?.llmProviders?.map((provider) => ({
            type: provider.type,
            name: provider.name,
            models: provider.models,
            isInstance: true,
            modelConfigs: provider.modelConfigs,
          })) ?? [],
        chatModel: aiConfig?.chatModel ?? undefined,
        capabilities: aiConfig?.capabilities,
        gatewayModels: aiConfig?.gatewayModels,
      },
      appGenerationEnabled: Boolean(appConfig?.vercelToken),
      availableIntegrationProviders,
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
    // Request AI to put the letter in quotes for strict validation
    const testPrompt =
      'What letter or character do you see in this image/file? ' +
      'Please respond with ONLY the letter wrapped in double quotes, like "X". ' +
      'Do not add any other text.';

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

      const responseText = res.text.trim();

      // Log the full response for debugging
      this.logger.log(
        `[testAttachment] Full AI response: "${responseText}", data preview: "${data.substring(0, 100)}..."`
      );

      // Strict validation: expect exactly "K" or "k" in quotes
      const quotedLetterMatch = responseText.match(/"([^"]+)"/);
      const letterInQuotes = quotedLetterMatch ? quotedLetterMatch[1].toLowerCase() : null;
      const containsExpectedInQuotes = letterInQuotes === expectedLetter;

      // Fallback: also check if response is just the letter (some models might not follow format)
      const isJustTheLetter =
        responseText.toLowerCase() === expectedLetter ||
        responseText.toLowerCase() === expectedLetter.toUpperCase();

      // Anti-hallucination checks:
      // 1. Response should be short (< 30 chars) - a direct answer
      const isShortResponse = responseText.length < 30;

      // 2. Response should not indicate inability to see the file
      const cannotSeeIndicators = [
        'cannot see',
        "can't see",
        'unable to',
        'no image',
        'no file',
        "don't see",
        'not visible',
        'not able to',
        'sorry',
        'error',
      ];
      const indicatesCannotSee = cannotSeeIndicators.some((indicator) =>
        responseText.toLowerCase().includes(indicator)
      );

      const isValid =
        (containsExpectedInQuotes || isJustTheLetter) && isShortResponse && !indicatesCannotSee;

      this.logger.log(
        `[testAttachment] Validation: letterInQuotes="${letterInQuotes}", ` +
          `containsExpectedInQuotes=${containsExpectedInQuotes}, isJustTheLetter=${isJustTheLetter}, ` +
          `isShortResponse=${isShortResponse}, indicatesCannotSee=${indicatesCannotSee}, ` +
          `isValid=${isValid}`
      );

      return isValid;
    } catch (error) {
      this.logger.error(
        `[testAttachment] Error: ${error instanceof Error ? error.message : unknownErrorMsg}`
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
   * Get test file buffer
   */
  private async getTestFileBuffer(filePath: string): Promise<Buffer | null> {
    try {
      const fullPath = resolve(process.cwd(), filePath);
      return await readFile(fullPath);
    } catch (error) {
      this.logger.error(`Failed to read test file ${filePath}: ${error}`);
      return null;
    }
  }

  /**
   * Get base64 data URL for a test file
   */
  private async getTestFileBase64(filePath: string, contentType: string): Promise<string | null> {
    const fileBuffer = await this.getTestFileBuffer(filePath);
    if (!fileBuffer) return null;

    const base64 = fileBuffer.toString('base64');
    return `data:${contentType};base64,${base64}`;
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

      // Handle AI Gateway separately using createGateway from AI SDK
      // See: https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway
      if (type === LLMProviderType.AI_GATEWAY) {
        const gatewayProvider = createGateway({
          apiKey,
          baseURL: baseUrl || undefined,
        });

        // Handle image generation model testing
        if (testImageGeneration) {
          // Gemini image models via Gateway use generateText, not generateImage
          throw new CustomHttpException(
            'Image generation testing not supported for AI Gateway models yet',
            HttpErrorCode.VALIDATION_ERROR
          );
        }

        // Standard text model testing
        const testPrompt = 'Hello, please respond with "Connection successful!"';
        const modelInstance = gatewayProvider(model) as unknown as LanguageModel;
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
      }

      const shouldTestImageGeneration = this.shouldTestImageGenerationModel(
        type,
        model,
        testImageGeneration
      );
      const provider = modelProviders[type as keyof typeof modelProviders];
      const providerOptions = getAdaptedProviderOptions(type, {
        name: model,
        baseURL: baseUrl,
        apiKey,
      });
      const modelProvider = provider({
        ...providerOptions,
      } as never) as OpenAIProvider;

      // Handle image generation model testing
      if (shouldTestImageGeneration) {
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

  private shouldTestImageGenerationModel(
    providerType: LLMProviderType,
    model: string,
    testImageGeneration?: boolean
  ): boolean {
    if (testImageGeneration != null) return testImageGeneration;

    const config =
      providerType === LLMProviderType.AI_GATEWAY
        ? getImageModelConfigByGatewayId(model)
        : getImageModelConfig(providerType, model);
    return config?.modelType === 'image';
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

      // OpenAI-style image generation (DALL-E, GPT Image, etc.)
      const imageModel = modelProvider.image(model);
      const size = this.getImageGenerationTestSize(providerType, model);
      const sizeOptions = size ? { size } : {};

      if (testImageToImage) {
        const testImageBuffer = await this.getTestFileBuffer(testImagePath);
        if (!testImageBuffer) {
          return {
            success: false,
            response: 'Test image file not found',
          };
        }

        // Test image-to-image: provide an image as input
        // Note: Not all image models support this, so we catch errors gracefully
        await generateImage({
          model: imageModel,
          prompt: {
            text: 'Create a very simple variation of this image.',
            images: [testImageBuffer],
          },
          n: 1,
          ...sizeOptions,
        });
      } else {
        // Test basic text-to-image generation
        await generateImage({
          model: imageModel,
          prompt: 'A simple test: draw a small red circle',
          n: 1,
          ...sizeOptions,
        });
      }

      return {
        success: true,
        response: testImageToImage
          ? 'Image-to-image generation successful'
          : 'Image generation successful',
      };
    } catch (error) {
      this.logger.error('testImageGenerationModel Error', (error as Error)?.stack);
      const message = error instanceof Error ? error.message : 'Image generation failed';
      return {
        success: false,
        response: message,
      };
    }
  }

  private getImageGenerationTestSize(
    providerType: LLMProviderType,
    model: string
  ): IImageSize | undefined {
    const config = getImageModelConfig(providerType, model);
    if (!config || config.modelType !== 'image') return undefined;
    return config.defaultSize ?? config.supportedSizes?.[0];
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
      let modelInstance: LanguageModel;

      // Handle AI Gateway separately
      if (type === LLMProviderType.AI_GATEWAY) {
        const gatewayProvider = createGateway({
          apiKey,
          baseURL: baseUrl || undefined,
        });
        modelInstance = gatewayProvider(model) as unknown as LanguageModel;
      } else {
        const providerFactory = modelProviders[type as keyof typeof modelProviders];

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
        } as never) as OpenAIProvider;
        modelInstance = modelProvider(model) as unknown as LanguageModel;
      }

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

  /**
   * Test API key validity for AI Gateway
   * Optionally also tests attachment transfer modes (URL and Base64)
   * When testAttachment is true, results are automatically saved to appConfig
   */
  async testApiKey(testApiKeyRo: ITestApiKeyRo): Promise<ITestApiKeyVo> {
    const { type, apiKey, baseUrl, testAttachment } = testApiKeyRo;

    if (type === 'aiGateway') {
      const keyResult = await this.testAiGatewayKey(apiKey, baseUrl);

      // If key test failed or attachment test not requested, return early
      if (!keyResult.success || !testAttachment) {
        return keyResult;
      }

      // Key is valid, now test attachment transfer modes
      const attachmentResult = await this.testAttachmentTransferModes(apiKey, baseUrl);

      // Auto-save results and switch mode if needed
      if (attachmentResult) {
        await this.saveAttachmentTestResults(attachmentResult);
      }

      return {
        ...keyResult,
        attachmentTest: attachmentResult,
      };
    } else if (type === 'vercel') {
      return this.testVercelToken(apiKey, baseUrl);
    }

    return { success: false, error: { code: 'unknown', message: 'Unknown API type' } };
  }

  private static readonly URL_CHECKER_ENDPOINT = 'https://access-checker.teable.ai/check';
  private static readonly URL_CHECKER_KEY = 'teable-checker-sk-2026xYz9Kw3mN7pQ';

  private getStorageTestFileUrl(): string | undefined {
    const { provider } = this.storageConfig;
    if (provider === 'local') {
      return undefined;
    }
    const logoPath = join(StorageAdapter.getDir(UploadType.Logo), EMAIL_LOGO_TOKEN);
    return getPublicFullStorageUrl(logoPath);
  }

  private async checkUrlAccessible(
    url: string,
    setting: { instanceId?: string; createdTime?: string | number | Date }
  ): Promise<{
    success: boolean;
    statusCode?: number;
    error?: string;
    checkedFrom?: string;
  }> {
    const deployedAt = String(setting.createdTime || '');
    const resp = await axios.get<{
      success: boolean;
      statusCode?: number;
      latencyMs: number;
      error?: string;
      checkedFrom: string;
    }>(SettingOpenApiService.URL_CHECKER_ENDPOINT, {
      timeout: 20000,
      params: {
        url,
        instanceId: setting.instanceId || '',
        version: resolveBuildVersion(),
        deployedAt,
      },
      headers: {
        Authorization: `Bearer ${SettingOpenApiService.URL_CHECKER_KEY}`,
      },
    });
    return resp.data;
  }

  private async checkStorageAccess(setting: {
    instanceId?: string;
    createdTime?: string | number | Date;
  }): Promise<ITestPublicAccessVo['storageCheck']> {
    const storageUrl = this.getStorageTestFileUrl();
    if (!storageUrl) {
      return undefined;
    }

    try {
      const data = await this.checkUrlAccessible(storageUrl, setting);
      if (data.success) {
        return { success: true, storageUrl };
      }
      return {
        success: false,
        storageUrl,
        error: data.error || `Not reachable (HTTP ${data.statusCode}) from ${data.checkedFrom}`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Storage check failed';
      this.logger.warn(`Storage access check failed: ${msg}`);
      return { success: false, storageUrl, error: msg };
    }
  }

  async testPublicAccess(): Promise<ITestPublicAccessVo> {
    const publicOrigin = this.baseConfig.publicOrigin;

    if (!publicOrigin) {
      return { success: false, error: 'PUBLIC_ORIGIN not set' };
    }

    try {
      const setting = await this.settingService.getSetting();

      const originData = await this.checkUrlAccessible(`${publicOrigin}/health`, setting);
      const originOk = originData.success;
      const originError = originOk
        ? undefined
        : originData.error ||
          `Not reachable (HTTP ${originData.statusCode}) from ${originData.checkedFrom}`;

      const storageCheck = await this.checkStorageAccess(setting);
      const allOk = originOk && (storageCheck?.success ?? true);

      return { success: allOk, publicOrigin, error: originError, storageCheck };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Check failed';
      this.logger.warn(`Public access check failed: ${message}`);
      return { success: false, publicOrigin, error: message };
    }
  }

  /**
   * Save attachment test results to aiConfig and auto-switch mode if needed
   */
  private async saveAttachmentTestResults(
    attachmentResult: NonNullable<ITestApiKeyVo['attachmentTest']>
  ): Promise<void> {
    try {
      const { aiConfig } = await this.settingService.getSetting();
      const currentMode = aiConfig?.attachmentTransferMode || 'url';

      // Prepare the update
      const update: {
        attachmentTest: NonNullable<ITestApiKeyVo['attachmentTest']> & { testedAt: string };
        attachmentTransferMode?: 'url' | 'base64';
      } = {
        attachmentTest: {
          ...attachmentResult,
          testedAt: new Date().toISOString(),
        },
      };

      // Auto-switch mode if:
      // 1. URL mode failed but Base64 succeeded -> switch to base64
      // 2. Current mode is base64 but now URL works -> switch to url (optional, keep user choice)
      const urlWorks = attachmentResult.urlMode?.success ?? false;
      const base64Works = attachmentResult.base64Mode?.success ?? false;

      if (!urlWorks && base64Works && currentMode === 'url') {
        // URL doesn't work, switch to base64
        update.attachmentTransferMode = 'base64';
        this.logger.log('Auto-switching attachment transfer mode to base64 (URL mode failed)');
      }
      // Note: We don't auto-switch back to URL even if it now works,
      // because the user might have intentionally chosen base64

      await this.settingService.updateSetting({
        aiConfig: {
          ...aiConfig,
          llmProviders: aiConfig?.llmProviders ?? [],
          ...update,
        },
      });
      this.logger.log('Saved attachment test results to aiConfig');
    } catch (error) {
      this.logger.error(`Failed to save attachment test results: ${error}`);
      // Don't throw - this is a non-critical operation
    }
  }

  /**
   * Test attachment transfer modes (URL and Base64) in parallel
   * Uses vision model to verify if AI can access attachments via each mode
   */
  private async testAttachmentTransferModes(
    apiKey: string,
    baseUrl?: string
  ): Promise<ITestApiKeyVo['attachmentTest']> {
    const testModel = 'openai/gpt-4o-mini';

    try {
      // Create gateway instance
      const gatewayOptions: { apiKey: string; baseURL?: string } = { apiKey };
      if (baseUrl) {
        gatewayOptions.baseURL = baseUrl;
      }
      const gateway = createGateway(gatewayOptions);
      const modelInstance = gateway(testModel);

      // Test image with both URL and Base64 modes in parallel
      const imageResult = await this.testAttachmentAbility(
        modelInstance,
        actTestImageToken,
        testImagePath,
        'image/png'
      );

      // Determine recommended mode based on test results
      let recommendedMode: 'url' | 'base64' | undefined;
      if (imageResult.url && imageResult.base64) {
        recommendedMode = 'url'; // Both work, prefer URL for performance
      } else if (!imageResult.url && imageResult.base64) {
        recommendedMode = 'base64'; // Only Base64 works
      } else if (imageResult.url && !imageResult.base64) {
        recommendedMode = 'url'; // Only URL works (rare case)
      }
      // If both fail, recommendedMode remains undefined

      return {
        urlMode: {
          success: imageResult.url ?? false,
          errorMessage: imageResult.url ? undefined : 'AI service cannot access attachment URL',
        },
        base64Mode: {
          success: imageResult.base64 ?? false,
          errorMessage: imageResult.base64
            ? undefined
            : 'AI service cannot process base64 attachment',
        },
        recommendedMode,
        testedOrigin: this.baseConfig.publicOrigin,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`testAttachmentTransferModes error: ${errorMessage}`);

      return {
        urlMode: { success: false, errorMessage },
        base64Mode: { success: false, errorMessage },
        testedOrigin: this.baseConfig.publicOrigin,
      };
    }
  }

  private async testAiGatewayKey(apiKey: string, baseUrl?: string): Promise<ITestApiKeyVo> {
    try {
      // Only set baseURL if user provided a custom one, otherwise use SDK default
      // SDK default: https://ai-gateway.vercel.sh/v1/ai
      const gatewayOptions: { apiKey: string; baseURL?: string } = { apiKey };
      if (baseUrl) {
        gatewayOptions.baseURL = baseUrl;
      }
      const gateway = createGateway(gatewayOptions);

      // Use a minimal generateText call to verify the key
      await generateText({
        model: gateway('openai/gpt-4o-mini'),
        prompt: 'hi',
      });

      return { success: true };
    } catch (error) {
      return this.parseApiKeyError(error, 'AI Gateway');
    }
  }

  private parseApiKeyError(error: unknown, service: string): ITestApiKeyVo {
    const errorMessage = String(error).toLowerCase();
    const rawMessage = String(error);
    const errorObj = error as {
      status?: number;
      statusCode?: number;
      message?: string;
      cause?: { status?: number; message?: string };
      data?: { error?: { type?: string; code?: string; message?: string } };
    };

    const status = errorObj.status || errorObj.statusCode || errorObj.cause?.status;
    const detailedMessage = errorObj.data?.error?.message || errorObj.message || rawMessage;

    this.logger.error(
      '%s key test failed: status=%s, message=%s, raw=%s',
      service,
      status,
      detailedMessage,
      rawMessage
    );

    // Determine error code based on status and message
    const code = this.getApiKeyErrorCode(status, errorMessage);
    return { success: false, error: { code, message: detailedMessage } };
  }

  private getApiKeyErrorCode(
    status: number | undefined,
    errorMessage: string
  ):
    | 'unauthorized'
    | 'forbidden'
    | 'need_credit_card'
    | 'insufficient_quota'
    | 'network_error'
    | 'unknown' {
    // 401 unauthorized
    if (
      status === 401 ||
      errorMessage.includes('401') ||
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('invalid api key') ||
      errorMessage.includes('invalid_api_key')
    ) {
      return 'unauthorized';
    }

    // 403 forbidden / credit card required
    if (status === 403 || errorMessage.includes('403')) {
      if (
        errorMessage.includes('customer_verification_required') ||
        errorMessage.includes('credit card')
      ) {
        return 'need_credit_card';
      }
      return 'forbidden';
    }

    // Insufficient quota
    if (
      errorMessage.includes('insufficient') ||
      errorMessage.includes('quota') ||
      errorMessage.includes('balance')
    ) {
      return 'insufficient_quota';
    }

    // Network errors
    if (
      errorMessage.includes('econnrefused') ||
      errorMessage.includes('enotfound') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('fetch failed')
    ) {
      return 'network_error';
    }

    return 'unknown';
  }

  private async testVercelToken(token: string, baseUrl?: string): Promise<ITestApiKeyVo> {
    const apiBase = baseUrl || 'https://api.vercel.com';

    const url = `${apiBase}/v2/user`;
    try {
      await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
      return { success: true };
    } catch (error) {
      if (!axios.isAxiosError(error)) {
        return this.parseApiKeyError(error, 'vercel');
      }

      const status = error.response?.status;
      const detailedMessage =
        (error.response?.data as { error?: { message?: string } })?.error?.message || error.message;

      this.logger.error('Vercel token test failed: status=%s, message=%s', status, detailedMessage);

      if (!error.response) {
        return { success: false, error: { code: 'network_error', message: detailedMessage } };
      }

      if (status === 401 || status === 403) {
        return { success: false, error: { code: 'unauthorized', message: detailedMessage } };
      }

      return { success: false, error: { code: 'unknown', message: detailedMessage } };
    }
  }

  /**
   * Get available models from AI Gateway
   * Returns empty array if gateway is not configured
   * Uses Redis cache with 1 hour TTL from SettingService
   */
  async getGatewayModels(): Promise<{
    configured: boolean;
    models: Array<{
      id: string;
      name?: string;
      description?: string;
      type?: GatewayModelType;
      tags?: GatewayModelTag[];
      contextWindow?: number;
      maxTokens?: number;
      created?: number;
      ownedBy?: GatewayModelProvider;
      pricing?: Record<string, unknown>;
    }>;
  }> {
    // Check if gateway is configured
    const { aiConfig } = await this.settingService.getSetting();
    if (!aiConfig?.aiGatewayApiKey) {
      return { configured: false, models: [] };
    }

    try {
      const models = await this.settingService.getGatewayModels();
      this.logger.log(`Fetched ${models.length} gateway models`);
      return { configured: true, models };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : '';
      this.logger.error(`Failed to fetch gateway models: ${errorMessage}`, errorStack);
      // Return configured=true but empty models on error
      // so frontend knows gateway is configured but had a fetch error
      return { configured: true, models: [] };
    }
  }
}
