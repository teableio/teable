export const reorder = <T>(list: T[], sourceIndex: number, targetIndex: number) => {
  const result = Array.from(list);
  const [removed] = result.splice(sourceIndex, 1);
  result.splice(targetIndex, 0, removed);

  return result;
};

export const moveTo = <T>({
  source,
  sourceIndex,
  target,
  targetIndex,
}: {
  source: T[];
  sourceIndex: number;
  target: T[];
  targetIndex: number;
}) => {
  const sourceList = Array.from(source);
  const targetList = Array.from(target);
  const [sourceCard] = sourceList.splice(sourceIndex, 1);

  targetList.splice(targetIndex, 0, sourceCard);

  return {
    sourceList,
    targetList,
  };
};
