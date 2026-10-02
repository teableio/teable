/**
 * The name every instance provider carries, AI Gateway and custom alike (tell those apart by
 * type). Space providers keep their own names and cannot take this one.
 */
export const INSTANCE_PROVIDER_NAME = 'teable';

/**
 * A full model key is `type@model@name`: exactly three non-empty segments. A model id with
 * an '@' of its own would add segments that a plain split('@') silently truncates, so keys
 * are checked with this before they are stored or resolved.
 */
export const isFullModelKey = (key: string | undefined): key is string => {
  if (!key) return false;
  const parts = key.split('@');
  return parts.length === 3 && parts.every((part) => part.length > 0);
};

interface IProviderLike {
  type: string;
  name: string;
  /** Comma-separated model ids. */
  models: string;
  displayName?: string;
}

/** The model ids a provider lists, from its comma-separated `models`. */
export const providerModelIds = (provider: Pick<IProviderLike, 'models'>): string[] =>
  provider.models
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

/**
 * The provider a `type@model@name` key names. Every instance provider is named `teable`, so
 * type and name alone can match several providers; the key identifies a model, and only the
 * provider listing that model is the one. A space's own provider that is the only one of its
 * type and name still serves a model it does not list, as it did before model matching.
 */
export const findProviderForModelKey = <T extends Pick<IProviderLike, 'type' | 'name' | 'models'>>(
  llmProviders: T[] | undefined,
  modelKey: string
): T | undefined => {
  if (!isFullModelKey(modelKey)) return undefined;
  const [type, model, name] = modelKey.split('@');
  const sameName = (llmProviders ?? []).filter(
    (provider) =>
      provider.type.toLowerCase() === type.toLowerCase() &&
      provider.name.toLowerCase() === name.toLowerCase()
  );
  const listing = sameName.find((provider) => providerModelIds(provider).includes(model));
  // Instance providers run on the platform key, so an unlisted model must never reach one.
  if (listing || name.toLowerCase() === INSTANCE_PROVIDER_NAME) return listing;
  return sameName.length === 1 ? sameName[0] : undefined;
};

export interface IDuplicateProviderModel {
  model: string;
  /** The two providers listing it, by display name or name. */
  providers: [string, string];
}

/** A model two providers of one type and name both list: its key could name either. */
export const findDuplicateProviderModel = (
  llmProviders: IProviderLike[] | undefined
): IDuplicateProviderModel | undefined => {
  const seen = new Map<string, { index: number; label: string }>();
  for (const [index, provider] of (llmProviders ?? []).entries()) {
    const label = provider.displayName || provider.name;
    for (const model of providerModelIds(provider)) {
      const key = `${provider.type.toLowerCase()}@${model}@${provider.name.toLowerCase()}`;
      const first = seen.get(key);
      if (first && first.index !== index) return { model, providers: [first.label, label] };
      seen.set(key, { index, label });
    }
  }
  return undefined;
};
