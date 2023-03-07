import { ThemeKey, useTheme } from '@teable-group/sdk';

export const ThemePicker: React.FC = () => {
  const { theme, isAutoTheme, setTheme } = useTheme();
  return (
    <select
      className="select select-bordered select-xs max-w-xs py-0"
      onChange={(e) => {
        console.log('select change: ', e.target.value);
        setTheme(e.target.value === '' ? null : (e.target.value as ThemeKey));
      }}
      value={isAutoTheme ? '' : theme}
    >
      {[ThemeKey.Light, ThemeKey.Dark].map((item) => {
        return (
          <option key={item} disabled={!isAutoTheme && theme === item} value={item}>
            {item}
          </option>
        );
      })}
      <option disabled={isAutoTheme} value="">
        auto
      </option>
    </select>
  );
};
