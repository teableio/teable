/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const authConfig = registerAs('auth', () => ({
  jwt: {
    secret: process.env.BACKEND_JWT_SECRET || '533Cr3tK3yF0rH4sh1nGJ4W773k3n$',
    expiresIn: process.env.BACKEND_JWT_EXPIRES_IN || '20d',
  },
}));

export const AuthConfig = () => Inject(authConfig.KEY);

export type IAuthConfig = ConfigType<typeof authConfig>;
