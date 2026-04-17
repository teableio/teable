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
  private _choiceMapKey = '';

  get displayChoiceMap() {
    const choices = this.options?.choices ?? [];
    const choicesKey = JSON.stringify(choices.map(({ id, name, color }) => [id, name, color]));
    if (this._choiceMapKey !== choicesKey) {
      const displayedChoices = choices.map(({ id, name, color }) => {
        return {
          id,
          name,
          color: ColorUtils.shouldUseLightTextOnColor(color) ? colors.white : colors.black,
          backgroundColor: ColorUtils.getHexForColor(color),
        };
      });
      this._choiceMap = keyBy(displayedChoices, 'name');
      this._choiceMapKey = choicesKey;
    }
    return this._choiceMap;
  }
}
