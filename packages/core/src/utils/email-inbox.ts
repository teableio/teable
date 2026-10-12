// Microsoft consumer domains, as listed by validator.js normalizeEmail.
const microsoftDomains = [
  'hotmail.at',
  'hotmail.be',
  'hotmail.ca',
  'hotmail.cl',
  'hotmail.co.il',
  'hotmail.co.nz',
  'hotmail.co.th',
  'hotmail.co.uk',
  'hotmail.com',
  'hotmail.com.ar',
  'hotmail.com.au',
  'hotmail.com.br',
  'hotmail.com.gr',
  'hotmail.com.mx',
  'hotmail.com.pe',
  'hotmail.com.tr',
  'hotmail.com.vn',
  'hotmail.cz',
  'hotmail.de',
  'hotmail.dk',
  'hotmail.es',
  'hotmail.fr',
  'hotmail.hu',
  'hotmail.id',
  'hotmail.ie',
  'hotmail.in',
  'hotmail.it',
  'hotmail.jp',
  'hotmail.kr',
  'hotmail.lv',
  'hotmail.my',
  'hotmail.ph',
  'hotmail.pt',
  'hotmail.sa',
  'hotmail.sg',
  'hotmail.sk',
  'live.be',
  'live.co.uk',
  'live.com',
  'live.com.ar',
  'live.com.mx',
  'live.de',
  'live.es',
  'live.eu',
  'live.fr',
  'live.it',
  'live.nl',
  'msn.com',
  'outlook.at',
  'outlook.be',
  'outlook.cl',
  'outlook.co.il',
  'outlook.co.nz',
  'outlook.co.th',
  'outlook.com',
  'outlook.com.ar',
  'outlook.com.au',
  'outlook.com.br',
  'outlook.com.gr',
  'outlook.com.pe',
  'outlook.com.tr',
  'outlook.com.vn',
  'outlook.cz',
  'outlook.de',
  'outlook.dk',
  'outlook.es',
  'outlook.fr',
  'outlook.hu',
  'outlook.id',
  'outlook.ie',
  'outlook.in',
  'outlook.it',
  'outlook.jp',
  'outlook.kr',
  'outlook.lv',
  'outlook.my',
  'outlook.ph',
  'outlook.pt',
  'outlook.sa',
  'outlook.sg',
  'outlook.sk',
  'passport.com',
];
const appleDomains = ['icloud.com', 'me.com', 'mac.com'];
const protonDomains = ['proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me'];
const yandexDomains = ['yandex.ru', 'yandex.com', 'yandex.by', 'yandex.kz', 'ya.ru'];

/**
 * The address a mailbox provider itself delivers to, so aliases of one inbox compare equal.
 * Only rewrites what the provider itself routes to one inbox:
 * - Gmail ignores dots and `+tag`.
 * - Microsoft, Apple and Proton ignore `+tag` but keep dots; Apple serves legacy accounts on
 *   me.com and mac.com too, Proton reserves each protonmail.com name on proton.me.
 * - Yandex ignores `+tag`, treats `-` as `.` and serves every account on all its country domains.
 * Custom domains (incl. Google Workspace) and Yahoo are left as-is.
 */
export const normalizeEmailInbox = (email: string): string => {
  const lowered = email.trim().toLowerCase();
  const at = lowered.lastIndexOf('@');
  if (at <= 0) {
    return lowered;
  }
  const local = lowered.slice(0, at);
  const domain = lowered.slice(at + 1);
  const untagged = local.split('+')[0] || local;

  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return `${untagged.replaceAll('.', '')}@gmail.com`;
  }
  if (microsoftDomains.includes(domain)) {
    return `${untagged}@${domain}`;
  }
  if (protonDomains.includes(domain)) {
    return `${untagged}@${domain === 'protonmail.com' ? 'proton.me' : domain}`;
  }
  if (appleDomains.includes(domain)) {
    return `${untagged}@icloud.com`;
  }
  if (yandexDomains.includes(domain)) {
    return `${untagged.replaceAll('-', '.')}@yandex.ru`;
  }
  return lowered;
};
