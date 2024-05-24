import { ColorUtils, SelectFieldCore } from '@teable/core';
import { keyBy } from 'lodash';
import colors from 'tailwindcss/colors';

export interface ISelectFieldDisplayChoice {
  id: string;
  name: string;
  color: string;
  backgroundColor: string;
}

export abstract class SelectFieldSdk extends SelectFieldCore {
  private _choiceMap: Record<string, ISelectFieldDisplayChoice> = {};

  get displayChoiceMap() {
    if (Object.keys(this._choiceMap).length === 0) {
      const displayedChoices = this.options.choices.map(({ id, name, color }) => {
        return {
          id,
          name,
          color: ColorUtils.shouldUseLightTextOnColor(color) ? colors.white : colors.black,
          backgroundColor: ColorUtils.getHexForColor(color),
        };
      });
      this._choiceMap = keyBy(displayedChoices, 'name');
    }
    return this._choiceMap;
  }
}
