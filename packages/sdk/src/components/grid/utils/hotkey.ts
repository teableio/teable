import { Key } from 'ts-key-enum';
import { Key as KeyCode } from 'ts-keycode-enum';

export const isPrintableKey = (event: KeyboardEvent) => {
  const { keyCode } = event;
  const { metaKey, ctrlKey } = event;

  if (metaKey || ctrlKey || keyCode === KeyCode.Space) return false;
  return (
    (keyCode >= KeyCode.A && keyCode <= KeyCode.Z) ||
    (keyCode >= KeyCode.ClosedParen && keyCode <= KeyCode.OpenParen) ||
    (keyCode >= KeyCode.Numpad0 && keyCode <= KeyCode.Numpad9) ||
    (keyCode >= KeyCode.SemiColon && keyCode <= KeyCode.Tilde) ||
    (keyCode >= KeyCode.OpenBracket && keyCode <= KeyCode.Quote) ||
    (keyCode >= KeyCode.Multiply && keyCode <= KeyCode.Divide) ||
    keyCode === KeyCode.Space ||
    keyCode === 61 ||
    keyCode === 173 ||
    ((keyCode === 229 || keyCode === 0) && event.key !== Key.Shift)
  );
};

export const isNumberKey = (keyCode: number) => {
  return (
    (keyCode >= KeyCode.ClosedParen && keyCode <= KeyCode.OpenParen) ||
    (keyCode >= KeyCode.Numpad0 && keyCode <= KeyCode.Numpad9)
  );
};
