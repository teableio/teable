import { Code2 } from '@teable/icons';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { CopyButton } from '@/features/app/components/CopyButton';

const appIconBasePath = '/images/app-icons';

const worksWith = [
  {
    name: 'Claude Code',
    iconLight: `${appIconBasePath}/app-claude-code-light.png`,
    iconDark: `${appIconBasePath}/app-claude-code-dark.png`,
  },
  {
    name: 'Codex',
    iconLight: `${appIconBasePath}/app-codex-light.png`,
    iconDark: `${appIconBasePath}/app-codex-dark.png`,
  },
  {
    name: 'OpenClaw',
    iconLight: `${appIconBasePath}/app-openclaw-light.png`,
    iconDark: `${appIconBasePath}/app-openclaw-dark.png`,
  },
  {
    name: 'Hermes',
    iconLight: `${appIconBasePath}/app-hermes-light.png`,
    iconDark: `${appIconBasePath}/app-hermes-dark.png`,
  },
  {
    name: 'Cursor',
    iconLight: `${appIconBasePath}/app-cursor-light.png`,
    iconDark: `${appIconBasePath}/app-cursor-dark.png`,
  },
] as const;

const StepNumber = ({ children }: { children: ReactNode }) => {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[11px] font-semibold leading-5 text-foreground dark:bg-zinc-50/20">
      {children}
    </span>
  );
};

const AgentBadge = ({
  name,
  iconLight,
  iconDark,
}: {
  name: string;
  iconLight: string;
  iconDark: string;
}) => {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs">
      <img
        alt=""
        aria-hidden="true"
        className="size-4 shrink-0 rounded-[4px] dark:hidden"
        src={iconLight}
      />
      <img
        alt=""
        aria-hidden="true"
        className="hidden size-4 shrink-0 rounded-[4px] dark:block"
        src={iconDark}
      />
      <span>{name}</span>
    </span>
  );
};

const CopyCard = ({
  text,
  label = 'Copy',
  title,
  children,
}: {
  text: string;
  label?: string;
  title?: ReactNode;
  children: ReactNode;
}) => {
  return (
    <div className="rounded-md border bg-surface px-4 pb-4 pt-3">
      <div className={`mb-1 flex items-center gap-4 ${title ? 'justify-between' : 'justify-end'}`}>
        {title && (
          <div className="min-w-0 flex-1 text-[13px] font-medium text-muted-foreground">
            {title}
          </div>
        )}
        <CopyButton text={text} label={label} variant="outline" size="xs" iconClassName="size-4" />
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
};

const StepSection = ({
  step,
  title,
  description,
  divider,
  children,
}: {
  step: number;
  title: string;
  description: ReactNode;
  divider?: boolean;
  children?: ReactNode;
}) => {
  return (
    <section className={`flex flex-col gap-3 p-5 ${divider ? 'border-b' : ''}`}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <StepNumber>{step}</StepNumber>
          <h2 className="text-sm font-semibold leading-5">{title}</h2>
        </div>
        <p className="pl-7 text-xs text-muted-foreground">{description}</p>
      </div>
      {children && <div>{children}</div>}
    </section>
  );
};

export const TeableSkillContent = () => {
  const { t } = useTranslation('common');
  const copy = {
    title: t('settings.setting.teableSkill'),
    intro: t('settings.teableSkill.intro'),
    worksWith: t('settings.teableSkill.worksWith'),
    more: t('settings.teableSkill.more'),
    copy: t('settings.teableSkill.copy'),
    installPromptLabel: t('settings.teableSkill.installPromptLabel'),
    installPrompt: t('settings.teableSkill.installPrompt'),
    step1Title: t('settings.teableSkill.step1Title'),
    step1Description: t('settings.teableSkill.step1Description'),
    step3Title: t('settings.teableSkill.step3Title'),
    step3Description: t('settings.teableSkill.step3Description'),
    tryPrompts: [
      {
        prompt: t('settings.teableSkill.tryPrompts.schema.prompt'),
        note: t('settings.teableSkill.tryPrompts.schema.note'),
      },
      {
        prompt: t('settings.teableSkill.tryPrompts.template.prompt'),
        note: t('settings.teableSkill.tryPrompts.template.note'),
      },
      {
        prompt: t('settings.teableSkill.tryPrompts.validate.prompt'),
        note: t('settings.teableSkill.tryPrompts.validate.note'),
      },
      {
        prompt: t('settings.teableSkill.tryPrompts.trace.prompt'),
        note: t('settings.teableSkill.tryPrompts.trace.note'),
      },
    ],
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 py-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold leading-7 text-foreground">{copy.title}</h1>
          <p className="max-w-4xl text-sm leading-6 text-muted-foreground">{copy.intro}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted px-4 py-2 text-sm text-muted-foreground dark:bg-surface">
          <span className="mr-1">{copy.worksWith}</span>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {worksWith.map(({ name, iconLight, iconDark }) => (
              <AgentBadge key={name} iconDark={iconDark} iconLight={iconLight} name={name} />
            ))}
            <span className="px-1 text-xs">{copy.more}</span>
          </div>
        </div>
      </div>

      <div className="rounded-md border bg-background">
        <StepSection step={1} title={copy.step1Title} description={copy.step1Description} divider>
          <CopyCard
            text={copy.installPrompt}
            label={copy.copy}
            title={
              <div className="flex items-center gap-2">
                <Code2 className="size-4" />
                <span>{copy.installPromptLabel}</span>
              </div>
            }
          >
            <p className="whitespace-pre-wrap text-sm leading-6">{copy.installPrompt}</p>
          </CopyCard>
        </StepSection>

        <StepSection step={2} title={copy.step3Title} description={copy.step3Description}>
          <div className="flex flex-col gap-3">
            {copy.tryPrompts.map(({ prompt, note }) => (
              <CopyCard key={prompt} text={prompt} label={copy.copy} title={note}>
                <p className="text-sm leading-6">{prompt}</p>
              </CopyCard>
            ))}
          </div>
        </StepSection>
      </div>
    </div>
  );
};
