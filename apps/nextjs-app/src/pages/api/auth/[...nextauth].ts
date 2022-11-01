import NextAuth from 'next-auth';
import { nextAuthConfig } from '@/config/next-auth.config';

export default NextAuth(nextAuthConfig);
