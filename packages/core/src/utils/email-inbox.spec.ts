import { normalizeEmailInbox } from './email-inbox';

describe('normalizeEmailInbox', () => {
  it.each([
    ['a.b.c@gmail.com', 'abc@gmail.com'],
    ['abc+1@gmail.com', 'abc@gmail.com'],
    ['A.B.C+x@GoogleMail.com', 'abc@gmail.com'],
    ['a.b+1@outlook.com', 'a.b@outlook.com'],
    ['a.b+1@hotmail.co.uk', 'a.b@hotmail.co.uk'],
    ['a.b+1@live.com.mx', 'a.b@live.com.mx'],
    ['a.b+1@msn.com', 'a.b@msn.com'],
    ['a.b+1@icloud.com', 'a.b@icloud.com'],
    ['a+1@me.com', 'a@icloud.com'],
    ['a.b@mac.com', 'a.b@icloud.com'],
    ['a.b+1@proton.me', 'a.b@proton.me'],
    ['a.b+1@protonmail.com', 'a.b@proton.me'],
    ['a.b+1@pm.me', 'a.b@pm.me'],
    ['John-2009+1@yandex.com', 'john.2009@yandex.ru'],
    ['john.2009@ya.ru', 'john.2009@yandex.ru'],
    ['john-2009@yandex.kz', 'john.2009@yandex.ru'],
  ])('maps %s to its inbox %s', (email, inbox) => {
    expect(normalizeEmailInbox(email)).toBe(inbox);
  });

  it.each([
    'a.b+1@company.com',
    'a.b+1@outlook.example.com',
    'foo-bar@yahoo.com',
    'a-b+1@yandex.ua',
  ])('keeps %s as-is apart from case', (email) => {
    expect(normalizeEmailInbox(email.toUpperCase())).toBe(email);
  });

  it('keeps outlook dots significant', () => {
    expect(normalizeEmailInbox('a.b@outlook.com')).not.toBe(normalizeEmailInbox('ab@outlook.com'));
  });
});
