import express from 'express';
import path from 'node:path';

import { env } from './config/env.js';

export const publicAssetDirectories = ['items', 'logos', 'signatures', 'stamps'] as const;

export type PublicAssetDirectory = (typeof publicAssetDirectories)[number];

const storageRoot = path.resolve(process.cwd(), 'storage');

export function publicAssetPath(directory: PublicAssetDirectory) {
  return path.resolve(storageRoot, directory);
}

export function setPublicAssetHeaders(res: Pick<express.Response, 'setHeader'>) {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
}

export function createPublicAssetStaticMiddleware(directory: PublicAssetDirectory) {
  return express.static(publicAssetPath(directory), {
    dotfiles: 'deny',
    index: false,
    fallthrough: false,
    maxAge: env.NODE_ENV === 'production' ? '1d' : 0,
    setHeaders: setPublicAssetHeaders,
  });
}
