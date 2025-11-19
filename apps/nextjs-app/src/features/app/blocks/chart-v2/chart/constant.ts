import { THEMES_KEYS } from '@teable/openapi';

const ANIMATION_CONFIG = {
  animation: true,
  animationDuration: 600,
  animationEasing: 'cubicOut' as const,
  animationDurationUpdate: 450,
  animationEasingUpdate: 'cubicOut' as const,
};

export const BASE_CHART_CONFIG = {
  ...ANIMATION_CONFIG,
};

export const THEMES = {
  [THEMES_KEYS.BLUE]: ['#8b9eff', '#4a5aff', '#3a4aff', '#3442ff', '#2d3aff'],
  [THEMES_KEYS.GREEN]: ['#a3e7b5', '#40c463', '#2da44e', '#1a7f37', '#0d5c2c'],
  [THEMES_KEYS.NEUTRAL]: ['#d97706', '#5a9ca6', '#4b5563', '#e8d44d', '#d4a650'],
  [THEMES_KEYS.ORANGE]: ['#f2c76e', '#e89542', '#d97706', '#b45309', '#8b3f0a'],
  [THEMES_KEYS.RED]: ['#f5c2b8', '#e06052', '#dc2626', '#b91c1c', '#991b1b'],
  [THEMES_KEYS.ROSE]: ['#ffc9c9', '#f87171', '#ef4444', '#dc2626', '#b91c1c'],
  [THEMES_KEYS.VIOLET]: ['#e9d5ff', '#c084fc', '#a855f7', '#9333ea', '#7e22ce'],
  [THEMES_KEYS.YELLOW]: ['#fef08a', '#fde047', '#eab308', '#ca8a04', '#a16207'],
};

export const DARK_THEMES = {
  [THEMES_KEYS.BLUE]: ['#8b9eff', '#4a5aff', '#3a4aff', '#3442ff', '#2d3aff'],
  [THEMES_KEYS.GREEN]: ['#a3e7b5', '#40c463', '#2da44e', '#1a7f37', '#0d5c2c'],
  [THEMES_KEYS.NEUTRAL]: ['#3442ff', '#40c463', '#d4a650', '#c084fc', '#f87171'],
  [THEMES_KEYS.ORANGE]: ['#f2c76e', '#e89542', '#d97706', '#b45309', '#8b3f0a'],
  [THEMES_KEYS.RED]: ['#f5c2b8', '#e06052', '#dc2626', '#b91c1c', '#991b1b'],
  [THEMES_KEYS.ROSE]: ['#ffc9c9', '#f87171', '#ef4444', '#dc2626', '#b91c1c'],
  [THEMES_KEYS.VIOLET]: ['#e9d5ff', '#c084fc', '#a855f7', '#9333ea', '#7e22ce'],
  [THEMES_KEYS.YELLOW]: ['#fef08a', '#fde047', '#eab308', '#ca8a04', '#a16207'],
};
