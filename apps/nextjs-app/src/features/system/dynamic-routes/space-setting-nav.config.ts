import { BarChart2, CreditCard, Settings, Users, Webhook } from '@teable/icons';

export const spaceSettingNavConfig = (
  spaceId: string
): {
  [group: string]: {
    text: string;
    href: string;
    icon: React.FC<{ className?: string }>;
    page: string | undefined;
  }[];
} => ({
  general: [
    {
      text: 'General',
      href: `/setting/${spaceId}`,
      icon: Settings,
      page: undefined,
    },
  ],
  access: [
    {
      text: 'Collaborators',
      href: `/setting/${spaceId}/access`,
      icon: Users,
      page: 'access',
    },
    {
      text: 'Billing and plans',
      href: `/setting/${spaceId}/billing`,
      icon: CreditCard,
      page: 'billing',
    },
    {
      text: 'Usage',
      href: `/setting/${spaceId}/usage`,
      icon: BarChart2,
      page: 'usage',
    },
  ],
  automation: [
    {
      text: 'Webhooks',
      href: `/setting/${spaceId}/hooks`,
      icon: Webhook,
      page: 'hooks',
    },
  ],
});
