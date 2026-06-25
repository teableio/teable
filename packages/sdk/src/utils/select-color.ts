import { Colors } from '@teable/core';
import type { ISelectFieldOptions } from '@teable/core';
import { keyBy } from 'lodash';
import { LRUCache } from 'lru-cache';

interface ISelectColorPair {
  color: string;
  backgroundColor: string;
}

export interface ISelectFieldDisplayChoice extends ISelectColorPair {
  id: string;
  name: string;
}

type ISelectTheme = 'light' | 'dark';
type ISelectLevel = 'Light2' | 'Light1' | 'Bright' | 'Base' | 'Dark1';
type ISelectFamily =
  | 'Blue'
  | 'Cyan'
  | 'Gray'
  | 'Green'
  | 'Orange'
  | 'Pink'
  | 'Purple'
  | 'Red'
  | 'Teal'
  | 'Yellow';
type ISelectColorMap = Record<ISelectTheme, Partial<Record<Colors, ISelectColorPair>>>;

const displayChoiceMapCache = new LRUCache<string, Record<string, ISelectFieldDisplayChoice>>({
  max: 200,
});

const lightTextColor = 'rgb(255 255 255)';
const darkTextColor = 'rgb(24 24 27)';

const levels = ['Light2', 'Light1', 'Bright', 'Base', 'Dark1'] as const satisfies ISelectLevel[];
const families = [
  'Blue',
  'Cyan',
  'Gray',
  'Green',
  'Orange',
  'Pink',
  'Purple',
  'Red',
  'Teal',
  'Yellow',
] as const satisfies ISelectFamily[];

const colorEnums: Record<ISelectFamily, Record<ISelectLevel, Colors>> = {
  Blue: {
    Light2: Colors.BlueLight2,
    Light1: Colors.BlueLight1,
    Bright: Colors.BlueBright,
    Base: Colors.Blue,
    Dark1: Colors.BlueDark1,
  },
  Cyan: {
    Light2: Colors.CyanLight2,
    Light1: Colors.CyanLight1,
    Bright: Colors.CyanBright,
    Base: Colors.Cyan,
    Dark1: Colors.CyanDark1,
  },
  Gray: {
    Light2: Colors.GrayLight2,
    Light1: Colors.GrayLight1,
    Bright: Colors.GrayBright,
    Base: Colors.Gray,
    Dark1: Colors.GrayDark1,
  },
  Green: {
    Light2: Colors.GreenLight2,
    Light1: Colors.GreenLight1,
    Bright: Colors.GreenBright,
    Base: Colors.Green,
    Dark1: Colors.GreenDark1,
  },
  Orange: {
    Light2: Colors.OrangeLight2,
    Light1: Colors.OrangeLight1,
    Bright: Colors.OrangeBright,
    Base: Colors.Orange,
    Dark1: Colors.OrangeDark1,
  },
  Pink: {
    Light2: Colors.PinkLight2,
    Light1: Colors.PinkLight1,
    Bright: Colors.PinkBright,
    Base: Colors.Pink,
    Dark1: Colors.PinkDark1,
  },
  Purple: {
    Light2: Colors.PurpleLight2,
    Light1: Colors.PurpleLight1,
    Bright: Colors.PurpleBright,
    Base: Colors.Purple,
    Dark1: Colors.PurpleDark1,
  },
  Red: {
    Light2: Colors.RedLight2,
    Light1: Colors.RedLight1,
    Bright: Colors.RedBright,
    Base: Colors.Red,
    Dark1: Colors.RedDark1,
  },
  Teal: {
    Light2: Colors.TealLight2,
    Light1: Colors.TealLight1,
    Bright: Colors.TealBright,
    Base: Colors.Teal,
    Dark1: Colors.TealDark1,
  },
  Yellow: {
    Light2: Colors.YellowLight2,
    Light1: Colors.YellowLight1,
    Bright: Colors.YellowBright,
    Base: Colors.Yellow,
    Dark1: Colors.YellowDark1,
  },
};

const levelTextColors: Record<ISelectTheme, Record<ISelectLevel, string>> = {
  light: {
    Light2: darkTextColor,
    Light1: darkTextColor,
    Bright: lightTextColor,
    Base: lightTextColor,
    Dark1: lightTextColor,
  },
  dark: {
    Light2: lightTextColor,
    Light1: lightTextColor,
    Bright: lightTextColor,
    Base: lightTextColor,
    Dark1: lightTextColor,
  },
};

const textColorOverrides: Record<ISelectTheme, Partial<Record<Colors, string>>> = {
  light: {
    [Colors.GrayBright]: darkTextColor,
    [Colors.OrangeBright]: darkTextColor,
    [Colors.YellowBright]: darkTextColor,
  },
  dark: {},
};

const backgroundColors: Record<
  ISelectTheme,
  Record<ISelectFamily, Record<ISelectLevel, string>>
> = {
  light: {
    Blue: {
      Base: 'rgb(51 109 244)',
      Bright: 'rgb(122 162 255)',
      Dark1: 'rgb(4 66 210)',
      Light1: 'rgb(194 212 255)',
      Light2: 'rgb(224 233 255)',
    },
    Cyan: {
      Base: 'rgb(4 127 176)',
      Bright: 'rgb(37 176 231)',
      Dark1: 'rgb(1 88 122)',
      Light1: 'rgb(151 220 252)',
      Light2: 'rgb(202 239 252)',
    },
    Gray: {
      Base: 'rgb(134 144 156)',
      Bright: 'rgb(201 205 212)',
      Dark1: 'rgb(78 89 105)',
      Light1: 'rgb(229 230 235)',
      Light2: 'rgb(242 243 245)',
    },
    Green: {
      Base: 'rgb(37 136 50)',
      Bright: 'rgb(53 189 75)',
      Dark1: 'rgb(11 96 23)',
      Light1: 'rgb(149 229 153)',
      Light2: 'rgb(208 245 206)',
    },
    Orange: {
      Base: 'rgb(194 87 5)',
      Bright: 'rgb(255 129 26)',
      Dark1: 'rgb(133 58 5)',
      Light1: 'rgb(254 196 139)',
      Light2: 'rgb(254 231 205)',
    },
    Pink: {
      Base: 'rgb(204 57 140)',
      Bright: 'rgb(235 120 184)',
      Dark1: 'rgb(157 21 98)',
      Light1: 'rgb(248 196 225)',
      Light2: 'rgb(254 226 242)',
    },
    Purple: {
      Base: 'rgb(141 85 237)',
      Bright: 'rgb(183 145 250)',
      Dark1: 'rgb(97 31 214)',
      Light1: 'rgb(220 201 253)',
      Light2: 'rgb(239 230 254)',
    },
    Red: {
      Base: 'rgb(226 46 40)',
      Bright: 'rgb(255 117 112)',
      Dark1: 'rgb(161 28 23)',
      Light1: 'rgb(253 198 196)',
      Light2: 'rgb(254 227 226)',
    },
    Teal: {
      Base: 'rgb(7 133 117)',
      Bright: 'rgb(43 190 171)',
      Dark1: 'rgb(4 93 81)',
      Light1: 'rgb(111 232 216)',
      Light2: 'rgb(196 242 236)',
    },
    Yellow: {
      Base: 'rgb(173 122 3)',
      Bright: 'rgb(255 198 10)',
      Dark1: 'rgb(111 74 1)',
      Light1: 'rgb(252 223 126)',
      Light2: 'rgb(250 237 194)',
    },
  },
  dark: {
    Blue: {
      Light2: 'rgb(30 44 79)',
      Light1: 'rgb(37 65 131)',
      Bright: 'rgb(41 78 166)',
      Base: 'rgb(46 92 201)',
      Dark1: 'rgb(51 109 244)',
    },
    Cyan: {
      Light2: 'rgb(19 49 63)',
      Light1: 'rgb(14 73 99)',
      Bright: 'rgb(11 90 122)',
      Base: 'rgb(8 106 146)',
      Dark1: 'rgb(4 127 176)',
    },
    Gray: {
      Light2: 'rgb(50 53 58)',
      Light1: 'rgb(77 82 89)',
      Bright: 'rgb(94 101 110)',
      Base: 'rgb(112 120 130)',
      Dark1: 'rgb(134 144 156)',
    },
    Green: {
      Light2: 'rgb(27 51 33)',
      Light1: 'rgb(30 78 38)',
      Bright: 'rgb(32 96 42)',
      Base: 'rgb(34 114 45)',
      Dark1: 'rgb(37 136 50)',
    },
    Orange: {
      Light2: 'rgb(65 39 22)',
      Light1: 'rgb(106 54 16)',
      Bright: 'rgb(133 64 13)',
      Base: 'rgb(160 74 9)',
      Dark1: 'rgb(194 87 5)',
    },
    Pink: {
      Light2: 'rgb(67 32 54)',
      Light1: 'rgb(110 40 81)',
      Bright: 'rgb(139 45 99)',
      Base: 'rgb(168 50 117)',
      Dark1: 'rgb(204 57 140)',
    },
    Purple: {
      Light2: 'rgb(52 39 77)',
      Light1: 'rgb(80 53 128)',
      Bright: 'rgb(99 63 161)',
      Base: 'rgb(118 73 195)',
      Dark1: 'rgb(141 85 237)',
    },
    Red: {
      Light2: 'rgb(72 29 30)',
      Light1: 'rgb(121 35 33)',
      Bright: 'rgb(153 38 35)',
      Base: 'rgb(186 42 37)',
      Dark1: 'rgb(226 46 40)',
    },
    Teal: {
      Light2: 'rgb(20 50 49)',
      Light1: 'rgb(16 76 70)',
      Bright: 'rgb(13 94 85)',
      Base: 'rgb(10 111 99)',
      Dark1: 'rgb(7 133 117)',
    },
    Yellow: {
      Light2: 'rgb(60 48 21)',
      Light1: 'rgb(96 71 15)',
      Bright: 'rgb(119 87 12)',
      Base: 'rgb(143 102 8)',
      Dark1: 'rgb(173 122 3)',
    },
  },
};

const buildColorMap = (theme: ISelectTheme) => {
  const colorMap: Partial<Record<Colors, ISelectColorPair>> = {};

  for (const family of families) {
    for (const level of levels) {
      const color = colorEnums[family][level];
      const backgroundColor = backgroundColors[theme][family][level];
      colorMap[color] = {
        color: textColorOverrides[theme][color] ?? levelTextColors[theme][level],
        backgroundColor,
      };
    }
  }

  return colorMap;
};

export const selectColorMap: ISelectColorMap = {
  light: buildColorMap('light'),
  dark: buildColorMap('dark'),
};

export const getSelectColorPairs = (color: Colors, theme: string = 'light') => {
  const themeKey: ISelectTheme = theme === 'dark' ? 'dark' : 'light';
  return (
    selectColorMap[themeKey][color] ??
    selectColorMap.light[color] ?? {
      color: levelTextColors.light.Light2,
      backgroundColor: backgroundColors.light.Gray.Light2,
    }
  );
};

export const getDisplayChoiceMap = (
  choices: ISelectFieldOptions['choices'] = [],
  theme: string = 'light'
) => {
  const themeKey: ISelectTheme = theme === 'dark' ? 'dark' : 'light';
  const choicesKey = JSON.stringify(choices.map(({ id, name, color }) => [id, name, color]));
  const cacheKey = `${themeKey}:${choicesKey}`;
  const cachedChoiceMap = displayChoiceMapCache.get(cacheKey);

  if (cachedChoiceMap) {
    return cachedChoiceMap;
  }

  const displayedChoices = choices.map(({ id, name, color }) => ({
    id,
    name,
    ...getSelectColorPairs(color, themeKey),
  }));
  const choiceMap = keyBy(displayedChoices, 'name') as Record<string, ISelectFieldDisplayChoice>;
  displayChoiceMapCache.set(cacheKey, choiceMap);
  return choiceMap;
};
