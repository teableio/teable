import type { DefaultSession } from 'next-auth';

// @link https://next-auth.js.org/getting-started/typescript#module-augmentation

declare module 'next-auth' {
  /**
   * The shape of the user object returned by the OAuth providers' `profile` callback,
   * or the second parameter of the `session` callback, when using a database.
   */
  interface User {
    role: string;
  }
  /**
   * Usually contains information about the provider being used
   * and also extends `TokenSet`, which is different tokens returned by OAuth Providers.
   */
  // interface Account {}
  /** The OAuth profile returned from your provider */
  // interface Profile {}

  interface Session {
    user: {
      role: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role: string;
  }
}
