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

/**
 * Credit ratio of each offered tier against the default tier, computed by the server from
 * what each tier bills. Absent for tiers that cost no platform credits.
 */
export type IModelTierCreditRatio = Partial<Record<IModelTierId, number>>;

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

/**
 * "2.5×", "0.6×", "12.5×": one decimal, rounded up so a badge never understates the cost and
 * a cheap tier reads "0.1×" rather than "0×"; undefined when that leaves 1, i.e. the tier
 * costs about the same as the default.
 */
export function formatCreditRatio(ratio: number | undefined): string | undefined {
  if (ratio === undefined || !Number.isFinite(ratio)) return undefined;
  // toFixed(6) strips float noise so 0.3 * 10 = 3.0000000000000004 stays 0.3, not 0.4
  const roundedUp = Math.ceil(Number((ratio * 10).toFixed(6))) / 10;
  return roundedUp === 1 ? undefined : `${roundedUp}×`;
}
