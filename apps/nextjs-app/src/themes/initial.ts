// attention: localStorage.getItem('ls_theme') should equal LocalStorageKeys.Theme in packages/sdk
export const INITIAL_THEME = `
  function getUserPreference() {
    const localStorageTheme = JSON.parse(window.localStorage.getItem('ls_theme'))
    if(localStorageTheme) {
      return localStorageTheme
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light'
  }
  const theme = getUserPreference();
  theme === 'dark' && document.documentElement.classList.add('dark');
`;
