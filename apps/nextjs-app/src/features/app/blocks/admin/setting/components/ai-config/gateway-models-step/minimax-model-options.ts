const MINIMAX_TEXT_MODELS = ['minimax/minimax-m3.1-flash', 'minimax/minimax-m3'];

/** Limit new MiniMax text choices while retaining saved models and catalog metadata. */
export function getMiniMaxModelOptions<T extends { id: string; type?: string; tags?: string[] }>(
  models: T[],
  selectedIds: Set<string>
): T[] {
  const isMiniMaxText = (model: T) =>
    model.id.startsWith('minimax/') &&
    (!model.type || model.type === 'language') &&
    !model.tags?.includes('image-generation');
  const visible = models.filter(
    (model) =>
      !isMiniMaxText(model) || MINIMAX_TEXT_MODELS.includes(model.id) || selectedIds.has(model.id)
  );
  const miniMaxModels = visible.filter(isMiniMaxText).sort((a, b) => {
    const priority = (id: string) => {
      const index = MINIMAX_TEXT_MODELS.indexOf(id);
      return index === -1 ? MINIMAX_TEXT_MODELS.length : index;
    };
    return priority(a.id) - priority(b.id);
  });
  let index = 0;
  // Keep other providers in their catalog positions and reuse the original objects.
  return visible.map((model) => (isMiniMaxText(model) ? miniMaxModels[index++] : model));
}
