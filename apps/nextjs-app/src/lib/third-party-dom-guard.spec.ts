import { installThirdPartyDomGuard } from './third-party-dom-guard';

describe('installThirdPartyDomGuard', () => {
  beforeAll(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installThirdPartyDomGuard();
  });

  it('keeps normal removeChild/insertBefore behavior intact', () => {
    const parent = document.createElement('div');
    const a = document.createElement('span');
    const b = document.createElement('span');
    parent.appendChild(a);
    expect(parent.insertBefore(b, a)).toBe(b);
    expect(Array.from(parent.childNodes)).toEqual([b, a]);
    expect(parent.removeChild(b)).toBe(b);
    expect(Array.from(parent.childNodes)).toEqual([a]);
  });

  it('no-ops removing a child a translator reparented', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.appendChild(child);
    // Simulate Google Translate wrapping the node into a <font>.
    const font = document.createElement('font');
    font.appendChild(child);
    expect(() => parent.removeChild(child)).not.toThrow();
    expect(child.parentNode).toBe(font);
  });

  it('appends instead of throwing when the anchor was reparented', () => {
    const parent = document.createElement('div');
    const sibling = document.createElement('em');
    const anchor = document.createElement('span');
    parent.append(sibling, anchor);
    const font = document.createElement('font');
    font.appendChild(anchor);
    const fresh = document.createElement('p');
    expect(() => parent.insertBefore(fresh, anchor)).not.toThrow();
    expect(fresh.parentNode).toBe(parent);
    expect(parent.lastChild).toBe(fresh);
  });

  it('does not double-wrap on repeated installs', () => {
    const removeChild = Node.prototype.removeChild;
    const insertBefore = Node.prototype.insertBefore;
    installThirdPartyDomGuard();
    expect(Node.prototype.removeChild).toBe(removeChild);
    expect(Node.prototype.insertBefore).toBe(insertBefore);
  });
});
