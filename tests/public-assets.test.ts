import { describe, expect, it, vi } from 'vitest';

import { publicAssetDirectories, publicAssetPath, setPublicAssetHeaders } from '../src/public-assets.js';

describe('public asset static configuration', () => {
  it('only exposes approved public image storage directories', () => {
    expect(publicAssetDirectories).toEqual(['items', 'logos', 'signatures', 'stamps']);
    expect(publicAssetDirectories).not.toContain('quotation-documents');
    expect(publicAssetDirectories).not.toContain('quotation-attachments');
  });

  it('confines public image directories under storage', () => {
    expect(publicAssetPath('items')).toMatch(/storage[/\\]items$/);
    expect(publicAssetPath('logos')).toMatch(/storage[/\\]logos$/);
  });

  it('uses a cross-origin resource policy for approved public images', () => {
    const setHeader = vi.fn();
    setPublicAssetHeaders({ setHeader });
    expect(setHeader).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'cross-origin');
  });
});
