import { isValidBannedEmailDomain, normalizeBannedEmailDomains } from '@teable/openapi';
import { Badge, Input, Label } from '@teable/ui-lib/shadcn';
import { X } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

export const BannedEmailDomains = ({
  bannedEmailDomains,
  onChange,
  disabled,
}: {
  bannedEmailDomains?: string[] | null;
  onChange: (domains: string[]) => Promise<unknown> | void;
  disabled?: boolean;
}) => {
  const { t } = useTranslation('common');
  const [domains, setDomains] = useState<string[]>(bannedEmailDomains ?? []);
  const [input, setInput] = useState('');
  const [hasInvalidInput, setHasInvalidInput] = useState(false);

  // Legacy entries that predate validation stay visible as removable
  // destructive chips, but are never sent back to the server.
  const save = (next: string[]) => {
    setDomains(next);
    void onChange(next.filter(isValidBannedEmailDomain));
  };

  const commitInput = () => {
    const candidates = normalizeBannedEmailDomains(input);
    if (!candidates.length) {
      setInput('');
      setHasInvalidInput(false);
      return;
    }
    const valid = candidates.filter(
      (domain) => isValidBannedEmailDomain(domain) && !domains.includes(domain)
    );
    const invalid = candidates.filter((domain) => !isValidBannedEmailDomain(domain));
    if (valid.length) {
      save([...domains, ...valid]);
    }
    setInput(invalid.join(' '));
    setHasInvalidInput(invalid.length > 0);
  };

  return (
    <div className="space-y-1 rounded-lg border bg-card p-4 shadow-sm">
      <Label htmlFor="banned-email-domains">{t('admin.setting.bannedEmailDomains')}</Label>
      <div className="text-xs text-muted-foreground">
        {t('admin.setting.bannedEmailDomainsDescription')}
      </div>
      {domains.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-2">
          {domains.map((domain) => (
            <Badge
              key={domain}
              variant={isValidBannedEmailDomain(domain) ? 'secondary' : 'destructive'}
              className="gap-1 font-normal"
            >
              {domain}
              <button
                type="button"
                aria-label={`${t('actions.delete')} ${domain}`}
                disabled={disabled}
                onClick={() => save(domains.filter((d) => d !== domain))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        id="banned-email-domains"
        className="mt-2 h-8"
        placeholder={t('admin.setting.bannedEmailDomainsInvalid')}
        value={input}
        disabled={disabled}
        onChange={(e) => {
          setInput(e.target.value);
          setHasInvalidInput(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitInput();
          }
        }}
        onBlur={commitInput}
      />
      {hasInvalidInput && (
        <p className="text-xs text-destructive">{t('admin.setting.bannedEmailDomainsInvalid')}</p>
      )}
    </div>
  );
};
