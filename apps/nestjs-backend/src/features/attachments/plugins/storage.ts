import Local from './local';

export default abstract class StorageAdapter {
  abstract getUploadUrl(): string;
}

export class Storage {
  static adapter() {
    return new Local();
  }
}
