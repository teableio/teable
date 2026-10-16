const appIconBasePath = '/images/app-icons';

/**
 * Local icons for MCP clients we recognize by the name they register with
 * (RFC 7591 `client_name`). We never render a logo a self-registered client
 * sends us: registration is anonymous, so a logo would only make a spoofed
 * "Claude Code" look more convincing. The name is shown either way, so keying
 * a bundled icon on it adds no trust the name does not already carry.
 */
const KNOWN_CLIENTS: { match: RegExp; icon: string }[] = [
  { match: /claude/i, icon: 'app-claude-code' },
  { match: /cursor/i, icon: 'app-cursor' },
  { match: /codex/i, icon: 'app-codex' },
  { match: /hermes/i, icon: 'app-hermes' },
  { match: /openclaw/i, icon: 'app-openclaw' },
];

export const getKnownClientIcon = (name: string): { light: string; dark: string } | undefined => {
  const known = KNOWN_CLIENTS.find(({ match }) => match.test(name));
  if (!known) return undefined;
  return {
    light: `${appIconBasePath}/${known.icon}-light.png`,
    dark: `${appIconBasePath}/${known.icon}-dark.png`,
  };
};
