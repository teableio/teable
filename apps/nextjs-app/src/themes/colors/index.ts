export const colors = {
  light: {
    info: '#3bbff7',
    infoContent: '#002b3e',
    success: '#37d39a',
    successContent: '#013321',
    warning: '#fabd23',
    warningContent: '#fabd23',
    error: '#f97272',
    errorContent: '#480000',
  },
  dark: {
    info: '#3bbff7',
    infoContent: '#002b3e',
    success: '#37d39a',
    successContent: '#013321',
    warning: '#fabd23',
    warningContent: '#fabd23',
    error: '#f97272',
    errorContent: '#480000',
  },
};

export type IColor = typeof colors.light | typeof colors.dark;
