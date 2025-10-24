import type { ReactElement, ReactNode } from 'react';
import { Children, cloneElement } from 'react';
import { useTranslation } from './useTranslation';

type ComponentsMap = Record<string, ReactElement>;

interface TransProps {
  i18nKey: string;
  components?: ComponentsMap;
  values?: Record<string, unknown>;
}

function cloneWithChildren(element: ReactElement, children: ReactNode[]): ReactElement {
  return cloneElement(element, undefined, ...children);
}

// split into small helpers to reduce complexity
type Token = { type: 'text' | 'open' | 'close' | 'self'; tag?: string; value?: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const regex = /<\/?([a-z0-9]+)\s*>|<([a-z0-9]+)\s*\/>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: input.slice(lastIndex, match.index) });
    }
    lastIndex = regex.lastIndex;
    const [full, tag, selfTag] = match;
    if (selfTag) {
      tokens.push({ type: 'self', tag: selfTag });
    } else if (full.startsWith('</')) {
      tokens.push({ type: 'close', tag });
    } else {
      tokens.push({ type: 'open', tag });
    }
  }
  if (lastIndex < input.length) tokens.push({ type: 'text', value: input.slice(lastIndex) });
  return tokens;
}

type Frame = { tag: string; children: ReactNode[] };

function pushText(stack: Frame[], value?: string) {
  if (value) stack[stack.length - 1].children.push(value);
}

function pushSelf(stack: Frame[], tag: string | undefined, components: ComponentsMap) {
  if (!tag) return;
  const comp = components[tag];
  stack[stack.length - 1].children.push(comp ? cloneElement(comp) : `<${tag}/>`);
}

function openTag(stack: Frame[], tag: string | undefined) {
  if (!tag) return;
  stack.push({ tag, children: [] });
}

function closeTag(stack: Frame[], tag: string | undefined, components: ComponentsMap) {
  if (!tag) return;
  const frame = stack.pop();
  if (!frame || frame.tag !== tag) {
    stack[stack.length - 1].children.push(`</${tag}>`);
    if (frame) stack.push(frame);
    return;
  }
  const comp = components[tag];
  const node = comp
    ? cloneWithChildren(comp, frame.children)
    : (frame.children as unknown as ReactNode);
  stack[stack.length - 1].children.push(node);
}

function buildNodes(tokens: Token[], components: ComponentsMap): ReactNode[] {
  const root: Frame = { tag: '#root', children: [] };
  const stack: Frame[] = [root];
  for (const token of tokens) {
    if (token.type === 'text') {
      pushText(stack, token.value);
    } else if (token.type === 'self') {
      pushSelf(stack, token.tag, components);
    } else if (token.type === 'open') {
      openTag(stack, token.tag);
    } else if (token.type === 'close') {
      closeTag(stack, token.tag, components);
    }
  }
  return root.children;
}

export const Trans = ({ i18nKey, components = {}, values }: TransProps) => {
  const { t } = useTranslation();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const source = String(t(i18nKey as any, values as any) ?? '');
  const nodes = buildNodes(tokenize(source), components);
  return <>{Children.toArray(nodes)}</>;
};
