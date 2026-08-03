import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { HttpErrorCode } from '@teable/core';
import multer from 'multer';
import sharp from 'sharp';
import { CustomHttpException } from '../custom.exception';
import { normalizeImageDimensions } from './image-orientation';

/** Supported avatar upload image types (gif not supported for cropping). */
export const AVATAR_ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
/** Max avatar upload size: 3MB. */
export const AVATAR_MAX_FILE_SIZE = 3 * 1024 * 1024;
/** Cropped avatar square dimension. */
export const AVATAR_SIZE = 128;
/** Output mimetype after cropping (see cropSquareAvatarImage → webp). */
export const AVATAR_OUTPUT_MIMETYPE = 'image/webp';

/** Shared multer options for avatar upload endpoints (disk storage + type filter + size limit). */
export const avatarUploadInterceptorOptions: MulterOptions = {
  // cropSquareAvatarImage reads from file.path, so avatar uploads must land on disk
  storage: multer.diskStorage({}),
  fileFilter: (_req, file, callback) => {
    if (AVATAR_ALLOWED_MIMETYPES.includes(file.mimetype)) {
      callback(null, true);
    } else {
      callback(
        new BadRequestException('Unsupported file type. Only JPEG, PNG, and WebP are allowed.'),
        false
      );
    }
  },
  limits: {
    fileSize: AVATAR_MAX_FILE_SIZE,
  },
};

/**
 * Crop avatar image to a square (center crop) and resize to the given size
 * Output format is WebP for better compression
 */
export const cropSquareAvatarImage = async (
  filePath: string,
  size = AVATAR_SIZE
): Promise<Buffer> => {
  try {
    const image = sharp(filePath, { failOn: 'none' }).rotate();
    const metadata = await image.metadata();
    const { width, height } = normalizeImageDimensions(metadata);

    if (!width || !height) {
      throw new CustomHttpException('Unsupported file type', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.attachment.invalidImage',
        },
      });
    }

    // Center crop to square
    const cropSize = Math.min(width, height);
    const left = Math.floor((width - cropSize) / 2);
    const top = Math.floor((height - cropSize) / 2);

    return await image
      .extract({ left, top, width: cropSize, height: cropSize })
      .resize(size, size)
      .webp({ quality: 85 })
      .toBuffer();
  } catch (error) {
    // If it's already a CustomHttpException, rethrow it
    if (error instanceof CustomHttpException) {
      throw error;
    }
    // For any other errors (e.g., unsupported format, corrupted file), throw 400
    throw new CustomHttpException('Unsupported file type', HttpErrorCode.VALIDATION_ERROR, {
      localization: {
        i18nKey: 'httpErrors.attachment.invalidImage',
      },
    });
  }
};
