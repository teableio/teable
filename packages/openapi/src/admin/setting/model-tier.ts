import { z } from 'zod';

// The chat model size slots double as the user-facing tiers, top capability
// first: xl = Ultra, lg = Smart (the default main model), md = Standard,
// sm = Lite. md / sm also serve background tasks; xl is only ever user-picked.
export const MODEL_TIER_IDS = ['xl', 'lg', 'md', 'sm'] as const;

export type IModelTierId = (typeof MODEL_TIER_IDS)[number];

export const modelTierIdSchema = z.enum(MODEL_TIER_IDS);

// The default main model; credit ratios shown on the other tiers are relative to it.
export const DEFAULT_MODEL_TIER: IModelTierId = 'lg';

// A chat client's model selection is either a full `type@model@name` key or a
// tier id; tier ids never contain '@', so the two never collide.
export const isModelTierId = (value: string | null | undefined): value is IModelTierId =>
  MODEL_TIER_IDS.includes(value as IModelTierId);

export interface IChatModelTierSlots {
  xl?: string;
  lg?: string;
  md?: string;
  sm?: string;
  hiddenTiers?: IModelTierId[];
  defaultTier?: IModelTierId;
}

/** The tier chat users land on: the main model (lg) unless the admin picked another. */
export const getDefaultModelTier = (
  chatModel: IChatModelTierSlots | null | undefined
): IModelTierId => chatModel?.defaultTier ?? DEFAULT_MODEL_TIER;

/**
 * The model a tier offers to users. Unset md / sm inherit the main model, as
 * they do for background tasks; unset xl and hidden tiers are not offered; the
 * default tier can never be hidden.
 */
export function getOfferedTierModelKey(
  chatModel: IChatModelTierSlots | null | undefined,
  tier: IModelTierId
): string | undefined {
  if (!chatModel) return undefined;
  if (tier !== getDefaultModelTier(chatModel) && chatModel.hiddenTiers?.includes(tier)) {
    return undefined;
  }
  return chatModel[tier] || (tier === 'xl' ? undefined : chatModel.lg) || undefined;
}
