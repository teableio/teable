import type { ComponentType, SVGProps } from 'react';
import Airtable from './Airtable';
import Amazon from './Amazon';
import AppleLogo from './AppleLogo';
import Atlassian from './Atlassian';
import BestBuy from './BestBuy';
import Canva from './Canva';
import Cloudflare from './Cloudflare';
import Crunchbase from './Crunchbase';
import Discord from './Discord';
import Ebay from './Ebay';
import Etsy from './Etsy';
import Facebook from './Facebook';
import Feishu from './Feishu';
import GithubLogo from './GithubLogo';
import GoogleLogo from './GoogleLogo';
import GoogleSheet from './GoogleSheet';
import HomeDepot from './HomeDepot';
import InIcon from './InIcon';
import Instagram from './Instagram';
import Intercom from './Intercom';
import Linear from './Linear';
import LinkedIn from './LinkedIn';
import Mercury from './Mercury';
import MicrosoftTeams from './MicrosoftTeams';
import Notion from './Notion';
import PostHog from './PostHog';
import Reddit from './Reddit';
import Sentry from './Sentry';
import Slack from './Slack';
import Stripe from './Stripe';
import Telegram from './Telegram';
import TikTok from './TikTok';
import Twitter from './Twitter';
import Vercel from './Vercel';
import Walmart from './Walmart';
import Yahoo from './Yahoo';
import YouTube from './YouTube';
import Zapier from './Zapier';
import Zara from './Zara';
import ZoomInfo from './ZoomInfo';

/**
 * The marks of the apps and services Teable connects to, imports from, scrapes and signs in
 * with. They are added by hand, so they live apart from `components/`, which `pnpm generate`
 * clears and rebuilds from Figma. AI model vendors' marks stay with the other icons.
 */
export {
  Airtable,
  Amazon,
  AppleLogo,
  Atlassian,
  BestBuy,
  Canva,
  Cloudflare,
  Crunchbase,
  Discord,
  Ebay,
  Etsy,
  Facebook,
  Feishu,
  GithubLogo,
  GoogleLogo,
  GoogleSheet,
  HomeDepot,
  InIcon,
  Instagram,
  Intercom,
  Linear,
  LinkedIn,
  Mercury,
  MicrosoftTeams,
  Notion,
  PostHog,
  Reddit,
  Sentry,
  Slack,
  Stripe,
  Telegram,
  TikTok,
  Twitter,
  Vercel,
  Walmart,
  Yahoo,
  YouTube,
  Zapier,
  Zara,
  ZoomInfo,
};

type BrandLogo = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Each brand's mark by its slug: lower case, letters and digits only, as Composio names its
 * toolkits (`googlesheets`, `microsoftteams`). Only a brand's own mark is listed: Gmail is
 * absent rather than drawn as Google's.
 */
export const BRAND_LOGOS: Record<string, BrandLogo | undefined> = {
  airtable: Airtable,
  amazon: Amazon,
  apple: AppleLogo,
  atlassian: Atlassian,
  bestbuy: BestBuy,
  canva: Canva,
  cloudflare: Cloudflare,
  crunchbase: Crunchbase,
  discord: Discord,
  ebay: Ebay,
  etsy: Etsy,
  facebook: Facebook,
  feishu: Feishu,
  github: GithubLogo,
  google: GoogleLogo,
  googlesheets: GoogleSheet,
  homedepot: HomeDepot,
  instagram: Instagram,
  intercom: Intercom,
  linear: Linear,
  linkedin: LinkedIn,
  mercury: Mercury,
  microsoftteams: MicrosoftTeams,
  notion: Notion,
  posthog: PostHog,
  reddit: Reddit,
  sentry: Sentry,
  slack: Slack,
  stripe: Stripe,
  telegram: Telegram,
  tiktok: TikTok,
  twitter: Twitter,
  vercel: Vercel,
  walmart: Walmart,
  yahoo: Yahoo,
  youtube: YouTube,
  zapier: Zapier,
  zara: Zara,
  zoominfo: ZoomInfo,
};

/** A brand's mark by its name or slug (`Google Sheets`, `google_sheets`); none when it has no mark here. */
export const brandLogo = (slug: string): BrandLogo | undefined =>
  BRAND_LOGOS[slug.toLowerCase().replace(/[^a-z0-9]/g, '')];
