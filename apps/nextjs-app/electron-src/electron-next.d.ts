declare module 'electron-next' {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface Directories {
    production: string;
    development: string;
  }

  export default function (
    directories: Directories | string,
    port?: number
  ): Promise<void>;
}
