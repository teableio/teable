export type ILogLevel = 'off' | 'on';

export interface IConfig {
  logger: ILoggerConfig;
  nextJs: INextJsConfig;
  cors: ICorsConfig;
  swagger: ISwaggerConfig;
  mail: IMailConfig;
}

export interface ILoggerConfig {
  level: {
    prismaQueryLog?: ILogLevel;
  };
}

export interface INextJsConfig {
  dir: string;
}

export interface ICorsConfig {
  enabled: boolean;
}

export interface ISwaggerConfig {
  enabled: boolean;
  title: string;
  description: string;
  version?: string;
  path?: string;
}

export interface IMailConfig {
  service?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  auth: {
    user: string;
    pass: string;
  };
}
