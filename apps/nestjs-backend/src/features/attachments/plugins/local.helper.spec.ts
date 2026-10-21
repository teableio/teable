/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import { resolve } from 'path';
import { READ_PATH } from '@teable/openapi';
import { describe, it, expect } from 'vitest';
import {
  assertPathWithinStorage,
  extractLocalFilePath,
  normalizeObjectPath,
  validateReadPath,
} from './local.helper';

const STORAGE_DIR = resolve('/data/storage');

describe('normalizeObjectPath', () => {
  it('collapses redundant separators and dot segments', () => {
    expect(normalizeObjectPath('private//table/./abc')).toBe('private/table/abc');
  });

  it('drops leading slashes', () => {
    expect(normalizeObjectPath('/private/table/abc')).toBe('private/table/abc');
  });

  it('leaves a canonical path untouched', () => {
    expect(normalizeObjectPath('private/table/abc')).toBe('private/table/abc');
  });
});

describe('assertPathWithinStorage', () => {
  it('should return resolved path for a valid relative path', () => {
    const result = assertPathWithinStorage('public/file.png', STORAGE_DIR);
    expect(result).toBe(resolve(STORAGE_DIR, 'public/file.png'));
  });

  it('should throw for empty path', () => {
    expect(() => assertPathWithinStorage('', STORAGE_DIR)).toThrow('Could not find attachment');
  });

  it('should throw for path traversal with ..', () => {
    expect(() => assertPathWithinStorage('../etc/passwd', STORAGE_DIR)).toThrow(
      'Could not find attachment'
    );
  });

  it('should throw for absolute path', () => {
    expect(() => assertPathWithinStorage('/etc/passwd', STORAGE_DIR)).toThrow(
      'Could not find attachment'
    );
  });
});

describe('validateReadPath', () => {
  it('should not throw for a valid relative path', () => {
    expect(() => validateReadPath('public/file.png', STORAGE_DIR)).not.toThrow();
  });

  it('should throw for empty path', () => {
    expect(() => validateReadPath('', STORAGE_DIR)).toThrow('Could not find attachment');
  });

  it('should throw for path traversal', () => {
    expect(() => validateReadPath('../../etc/passwd', STORAGE_DIR)).toThrow(
      'Could not find attachment'
    );
  });

  it('should throw for absolute path', () => {
    expect(() => validateReadPath('/etc/passwd', STORAGE_DIR)).toThrow('Could not find attachment');
  });
});

describe('extractLocalFilePath', () => {
  it('should extract relative path from a full local file URL', () => {
    const url = `http://localhost:3000${READ_PATH}/public/test-file.png`;
    expect(extractLocalFilePath(url, 'local', STORAGE_DIR)).toEqual({
      path: 'public/test-file.png',
    });
  });

  it('should extract relative path from pathname-only input', () => {
    const url = `${READ_PATH}/uploads/image.jpg`;
    expect(extractLocalFilePath(url, 'local', STORAGE_DIR)).toEqual({ path: 'uploads/image.jpg' });
  });

  // --- read token ---

  it('should return the read token carried by a full URL', () => {
    const url = `http://localhost:3000${READ_PATH}/private/table/abc?token=tok_123-A&response-content-disposition=attachment`;
    expect(extractLocalFilePath(url, 'local', STORAGE_DIR)).toEqual({
      path: 'private/table/abc',
      token: 'tok_123-A',
    });
  });

  it('should return the read token carried by a pathname-only URL', () => {
    const url = `${READ_PATH}/private/table/abc?token=tok`;
    expect(extractLocalFilePath(url, 'local', STORAGE_DIR)).toEqual({
      path: 'private/table/abc',
      token: 'tok',
    });
  });

  it('should leave the token undefined when the URL carries none', () => {
    const url = `${READ_PATH}/private/table/abc?response-content-disposition=attachment`;
    expect(extractLocalFilePath(url, 'local', STORAGE_DIR)?.token).toBeUndefined();
  });

  it('should return null for non-local provider', () => {
    const url = `http://localhost:3000${READ_PATH}/file.png`;
    expect(extractLocalFilePath(url, 's3', STORAGE_DIR)).toBeNull();
  });

  it('should return null for minio provider', () => {
    const url = `http://localhost:3000${READ_PATH}/file.png`;
    expect(extractLocalFilePath(url, 'minio', STORAGE_DIR)).toBeNull();
  });

  it('should return null for URLs without the READ_PATH prefix', () => {
    expect(
      extractLocalFilePath('http://example.com/some/other/path.png', 'local', STORAGE_DIR)
    ).toBeNull();
  });

  it('should return null for completely unrelated URLs', () => {
    expect(
      extractLocalFilePath('https://cdn.example.com/images/pic.jpg', 'local', STORAGE_DIR)
    ).toBeNull();
  });

  // --- Security: path traversal ---

  it('should reject path traversal with ..', () => {
    const url = `${READ_PATH}/../../../etc/passwd`;
    expect(extractLocalFilePath(url, 'local', STORAGE_DIR)).toBeNull();
  });

  it('should reject encoded path traversal (%2e%2e)', () => {
    const url = `http://localhost:3000${READ_PATH}/%2e%2e/%2e%2e/etc/passwd`;
    expect(extractLocalFilePath(url, 'local', STORAGE_DIR)).toBeNull();
  });

  it('should reject backslash-based traversal (..\\..\\)', () => {
    const url = `${READ_PATH}/..%5C..%5Cetc/passwd`;
    expect(extractLocalFilePath(url, 'local', STORAGE_DIR)).toBeNull();
  });

  it('should reject absolute paths', () => {
    const url = `http://localhost:3000${READ_PATH}//etc/passwd`;
    expect(extractLocalFilePath(url, 'local', STORAGE_DIR)).toBeNull();
  });

  // --- Edge cases ---

  it('should handle URL-encoded filenames with spaces', () => {
    const url = `http://localhost:3000${READ_PATH}/uploads/my%20file%20(1).png`;
    expect(extractLocalFilePath(url, 'local', STORAGE_DIR)?.path).toBe('uploads/my file (1).png');
  });

  it('should handle deeply nested paths', () => {
    const url = `${READ_PATH}/a/b/c/d/file.txt`;
    expect(extractLocalFilePath(url, 'local', STORAGE_DIR)?.path).toBe('a/b/c/d/file.txt');
  });

  it('should handle filenames with special characters', () => {
    const url = `${READ_PATH}/uploads/%E4%B8%AD%E6%96%87%E6%96%87%E4%BB%B6.png`;
    expect(extractLocalFilePath(url, 'local', STORAGE_DIR)?.path).toBe('uploads/中文文件.png');
  });
});
