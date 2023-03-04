import { ThemeKey, useTheme } from '@teable-group/sdk';

export const ThemeSelector: React.FC = () => {
  const { theme, isAutoTheme, setTheme } = useTheme();
  return (
    <select
      className="select select-bordered select-xs max-w-xs py-0"
      onChange={(e) => {
        console.log('select change: ', e.target.value);
        setTheme(e.target.value === 'auto' ? null : (e.target.value as ThemeKey));
      }}
    >
      {[ThemeKey.Light, ThemeKey.Dark].map((item) => {
        console.log({ item, theme, isAutoTheme });
        return (
          <option
            key={item}
            disabled={!isAutoTheme && theme === item}
            selected={!isAutoTheme && theme === item}
          >
            {item}
          </option>
        );
      })}
      <option key={'auto'} disabled={isAutoTheme} selected={isAutoTheme}>
        auto
      </option>
    </select>
  );
};
