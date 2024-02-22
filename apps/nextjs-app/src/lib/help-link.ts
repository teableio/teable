export const getHelpLink = () =>
  'https://help.' +
  (typeof window === 'object'
    ? window.location.hostname.split('.').slice(-2).join('.')
    : 'teable.io');
