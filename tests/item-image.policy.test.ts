import { describe, expect, it } from 'vitest';

import {
  ITEM_IMAGE_MAX_BYTES,
  toItemRelativePath,
  validateItemImageFile,
} from '../src/modules/items/images/item-image.policy.js';

describe('item image policy', () => {
  it('maps uploaded filenames to item storage-relative paths', () => {
    expect(toItemRelativePath(7, 'item-abc123.jpg')).toBe('firm-assets/7/items/item-abc123.jpg');
    expect(toItemRelativePath(7, '/unsafe/path/item-abc123.jpg')).toBe('firm-assets/7/items/item-abc123.jpg');
  });

  it('rejects unsupported MIME types and mismatched extensions', () => {
    expect(
      validateItemImageFile({
        mimetype: 'image/gif',
        originalname: 'photo.gif',
        size: 1024,
      }),
    ).toMatchObject({
      statusCode: 415,
      message: 'Unsupported item image type',
    });

    expect(
      validateItemImageFile({
        mimetype: 'image/png',
        originalname: 'photo.jpg',
        size: 1024,
      }),
    ).toMatchObject({
      statusCode: 415,
      message: 'File extension does not match image type',
    });
  });

  it('rejects files above the 5 MB limit', () => {
    expect(
      validateItemImageFile({
        mimetype: 'image/jpeg',
        originalname: 'photo.jpg',
        size: ITEM_IMAGE_MAX_BYTES + 1,
      }),
    ).toMatchObject({
      statusCode: 413,
      message: 'Item image exceeds the 5 MB limit',
    });
  });

  it('accepts valid JPEG uploads with jpg or jpeg extensions', () => {
    expect(
      validateItemImageFile({
        mimetype: 'image/jpeg',
        originalname: 'photo.jpg',
        size: 1024,
      }),
    ).toBeNull();

    expect(
      validateItemImageFile({
        mimetype: 'image/jpeg',
        originalname: 'photo.jpeg',
        size: 1024,
      }),
    ).toBeNull();
  });
});
