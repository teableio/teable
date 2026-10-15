import { render } from '@/test-utils';
import { PasswordInput } from '../PasswordInput';

describe('PasswordInput', () => {
  it('does not crash on key/mouse events without the modifier-state API', () => {
    render(<PasswordInput value="" onChange={() => undefined} />);

    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.error);
    };
    window.addEventListener('error', onError);

    try {
      // Extensions, automation and native shells may dispatch plain `Event`s
      // with key/mouse types; `getModifierState` does not exist on them.
      document.dispatchEvent(new Event('keydown'));
      document.dispatchEvent(new Event('keyup'));
      document.dispatchEvent(new Event('mousedown'));
    } finally {
      window.removeEventListener('error', onError);
    }

    expect(errors).toStrictEqual([]);
  });
});
