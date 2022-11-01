import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

const oneDayInSeconds = 86400;

export const nextAuthConfig: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      // The name to display on the sign-in form (e.g. "Sign in with...")
      name: 'Credentials',
      // The credentials are used to generate a suitable form on the sign-in page.
      // You can specify whatever fields you are expecting to be submitted.
      // e.g. domain, username, password, 2FA token, etc.
      // You can pass any HTML attribute to the <input> tag through the object.
      credentials: {
        username: {
          label: 'Username',
          type: 'text',
          placeholder: 'me@example.com',
        },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, _req) {
        if (!credentials) throw new Error('No credentials provided');
        const { username, password } = credentials ?? {};
        if (username === 'admin' && password === 'demo') {
          return {
            id: '1',
            name: 'admin',
            email: 'admin@example.com',
            role: 'admin',
            image: undefined,
          };
        }
        throw new Error('Wrong credentials');
      },
    }),
  ],
  theme: {
    colorScheme: 'light',
  },
  session: {
    strategy: 'jwt',
  },
  /**
     session: {
    // When using `"database"`, the session cookie will only contain a `sessionToken` value,
    // which is used to look up the session in the database.
    strategy: 'jwt',
    maxAge: oneDayInSeconds * 30,
    // Seconds - Throttle how frequently to write to database to extend a session.
    // Use it to limit write operations. Set to 0 to always update the database.
    // Note: This option is ignored if using JSON Web Tokens
    // updateAge: 24 * 60 * 60, // 24 hours
  }, */
  jwt: {
    // The maximum age of the NextAuth.js issued JWT in seconds.
    // Defaults to `session.maxAge`.
    maxAge: oneDayInSeconds * 30,
    // You can define your own encode/decode functions for signing and encryption
    // async encode() {},
    // async decode() {},
  },
  callbacks: {
    /*
    async signIn({ user, account, profile, email, credentials }) {
      return true;
    },
    */
    async redirect({ url, baseUrl }) {
      return url.startsWith(baseUrl) ? url : baseUrl;
    },
    // async session({ session, token, user }) {
    async session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          role: token.role as string,
        },
      };
    },
    // async jwt({ token, user, account, profile, isNewUser }) {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
      }
      return token;
    },
  },
  pages: {
    signIn: '/auth/login',
    /*
     signOut: '/auth/signout',
     error: '/auth/error', // Error code passed in query string as ?error=
     verifyRequest: '/auth/verify-request', // (used for check email message)
     newUser: '/auth/new-user', // New users will be directed here on first sign in (leave the property out if not of interest)
    */
  },
};
