import { resolve, join } from 'path';
import * as fse from 'fs-extra';
import type { Sharp } from 'sharp';
import sharp from 'sharp';
import { vi } from 'vitest';
import Local from './local';

const mockSharpInstance = {
  metadata: vi.fn(),
};

vi.mock('fs-extra', () => ({
  ensureDir: vi.fn(),
  copy: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('sharp', () => ({
  default: vi.fn((_path: string) => {
    return mockSharpInstance as Partial<Sharp>;
  }),
}));

vi.mock('fs', () => ({
  createReadStream: vi.fn(() => 'stream'),
}));

describe('Local', () => {
  let local: Local;

  beforeEach(() => {
    local = new Local();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return upload url', () => {
    expect(local.getUploadUrl()).toBe('/api/attachments/upload');
  });

  it('should save a file', async () => {
    const file = {
      path: '/tmp/uploads/testfile.jpg',
      originalname: 'testfile.jpg',
    };

    const rename = 'newfile.jpg';
    const result = await local.save(file as Express.Multer.File, rename);

    expect(fse.ensureDir).toHaveBeenCalledWith(resolve(local.storageDir));
    expect(fse.copy).toHaveBeenCalledWith(file.path, resolve(local.storageDir, rename));
    expect(fse.unlink).toHaveBeenCalledWith(file.path);
    expect(result).toBe(join(local.path, rename));
  });

  it('should read a file', () => {
    const filePath = 'newfile.jpg';
    const stream = local.read(filePath);
    expect(stream).toBe('stream');
  });

  it('should get image width and height', async () => {
    mockSharpInstance.metadata.mockResolvedValueOnce({ width: 100, height: 200 });
    const path = '/tmp/uploads/testfile.jpg';
    const dimensions = await local.getImageWidthAndHeight(path);
    expect(dimensions).toEqual({ width: 100, height: 200 });
    expect(sharp).toHaveBeenCalledWith(path);
  });
});
