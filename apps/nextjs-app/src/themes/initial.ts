export const INITIAL_THEME = `
  function getUserPreference() {
    if(window.localStorage.getItem('teable_theme')) {
      return JSON.parse(window.localStorage.getItem('teable_theme'))
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light'
  }
  document.documentElement.setAttribute('data-theme', getUserPreference());
`;
