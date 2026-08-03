export interface IImpactGroup {
  fieldIds: Set<string>;
  recordIds: Set<string>;
}

export type IImpactMap = Record<string, IImpactGroup>;

export type IResultImpact = Record<string, { fieldIds: string[]; recordIds: string[] }>;

export function buildResultImpact(impact: IImpactMap): IResultImpact {
  return Object.entries(impact).reduce<IResultImpact>((acc, [tid, group]) => {
    acc[tid] = {
      fieldIds: Array.from(group.fieldIds),
      recordIds: Array.from(group.recordIds),
    };
    return acc;
  }, {});
}
