import Local from './local';

export default abstract class StorageAdapter {
  abstract getUploadUrl(): string;
  abstract getUrl(token: string): string;
}

export class Storage {
  static adapter() {
    return new Local();
  }
}
