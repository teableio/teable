import type { IComboConfig, IComboType } from '../../../../types';

export type ComboXAxis = NonNullable<IComboConfig['xAxis']>[number];
export type ComboYAxis = NonNullable<IComboConfig['yAxis']>[number];

export const getComboXAxisDefaultDisplay = (type: IComboType): ComboXAxis['display'] => {
  switch (type) {
    case 'bar':
      return {
        type,
        position: 'auto',
      };
    case 'area':
    case 'line':
      return {
        lineStyle: 'normal',
        type,
        position: 'auto',
      };
    default:
      throw new Error('Invalid type');
  }
};

// eslint-disable-next-line sonarjs/no-identical-functions
export const getComboYAxisDefaultDisplay = (type: IComboType): ComboYAxis['display'] => {
  switch (type) {
    case 'bar':
      return {
        type,
        position: 'auto',
      };
    case 'area':
    case 'line':
      return {
        lineStyle: 'normal',
        type,
        position: 'auto',
      };
    default:
      throw new Error('Invalid type');
  }
};
