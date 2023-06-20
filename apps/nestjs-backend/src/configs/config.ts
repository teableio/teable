import type { IConfig, ILogLevel } from './config.interface';

const loadConfig: IConfig = {
  logger: {
    level: {
      prismaQueryLog: (process.env.LOGGER_LEVEL_PRISMAQUERYLOG as ILogLevel) || 'off',
    },
  },
  nextJs: {
    dir: process.env.NEXTJS_DIR || '../nextjs-app',
  },
  cors: {
    enabled: true,
  },
  swagger: {
    enabled: true,
    title: process.env.BACKEND_SWAGGER_TITLE || 'Teable App',
    description: 'Manage Data as easy as drink a cup of tea',
    version: '1.0',
    path: 'docs',
  },
  mail: {
    service: process.env.BACKEND_MAIL_SERVICE || 'smtp.163.com',
    host: process.env.BACKEND_MAIL_HOST || 'smtp.163.com',
    port: parseInt(process.env.BACKEND_MAIL_PORT || '465', 10),
    secure: Object.is(process.env.BACKEND_MAIL_SECURE || 'true', 'true'),
    auth: {
      user: process.env.BACKEND_MAIL_AUTH_USER!,
      pass: process.env.BACKEND_MAIL_AUTH_PASS!,
    },
  },
};

export default (): IConfig => loadConfig;
