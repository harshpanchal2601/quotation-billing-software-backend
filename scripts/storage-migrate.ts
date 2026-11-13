import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { env, parseEnv } from '../src/config/env.js';
import { storageConfig } from '../src/config/storage.config.js';
import { createStorageService } from '../src/integrations/storage/storage.service.js';

// Copy only. Neither source deletion nor database path rewriting is needed.
// The default is a dry run; matching objects are skipped, differing ones fail.
const argumentsSet = new Set(process.argv.slice(2));
if ([...argumentsSet].some((argument) => !['--apply', '--to-local', '--dry-run'].includes(argument)) || argumentsSet.has('--apply') && argumentsSet.has('--dry-run')) throw new Error('Use --dry-run or --apply, optionally with --to-local.');
const validated = parseEnv({ ...process.env, STORAGE_DRIVER: 's3' });
const remote = createStorageService({ ...storageConfig, driver: 's3', bucket: validated.STORAGE_S3_BUCKET, region: validated.STORAGE_S3_REGION, prefix: validated.STORAGE_S3_PREFIX.replace(/\/$/, ''), expectedBucketOwner: validated.STORAGE_S3_EXPECTED_BUCKET_OWNER || undefined });
const apply = argumentsSet.has('--apply');
const toLocal = argumentsSet.has('--to-local');
const local = createStorageService({ ...storageConfig, driver: 'local' });
const manifestPath = path.resolve(storageConfig.root, '..', 'storage-migration-manifest.json');
type Entry = { key: string; size: number; sha256: string };
async function digestFile(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function inventory(directory: string, prefix = ''): Promise<Entry[]> {
  const entries: Entry[] = [];
  let children;
  try { children = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []; throw error; }
  for (const entry of children) {
    if (entry.name.startsWith('.')) continue;
    const key = [prefix, entry.name].filter(Boolean).join('/');
    const fullPath = local.resolveStoragePath(key);
    if (entry.isSymbolicLink()) throw new Error('Storage migration refuses symbolic links.');
    if (entry.isDirectory()) entries.push(...await inventory(fullPath, key));
    else if (entry.isFile()) entries.push({ key, size: (await fs.stat(fullPath)).size, sha256: await digestFile(fullPath) });
  }
  return entries;
}
async function remoteInventory(): Promise<Entry[]> {
  const client = new S3Client({ region: validated.STORAGE_S3_REGION, maxAttempts: 3 });
  const prefix = validated.STORAGE_S3_PREFIX.replace(/\/$/, '');
  const base = prefix ? `${prefix}/` : '';
  const entries: Entry[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: validated.STORAGE_S3_BUCKET, Prefix: base, ContinuationToken: token, ExpectedBucketOwner: storageConfig.expectedBucketOwner }));
    for (const object of page.Contents ?? []) {
      if (!object.Key || !object.Key.startsWith(base) || object.Key.endsWith('/')) continue;
      const key = object.Key.slice(base.length);
      local.resolveStoragePath(key);
      const bytes = await remote.readStorageFile(key);
      entries.push({ key, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    token = page.NextContinuationToken;
    if (page.IsTruncated && !token) throw new Error('Incomplete remote storage inventory.');
  } while (token);
  client.destroy();
  return entries;
}
if (!toLocal) await fs.access(storageConfig.root);
const entries = toLocal ? await remoteInventory() : await inventory(storageConfig.root);
if (toLocal) {
  const expected = new Map(entries.map((entry) => [entry.key, entry]));
  for (const existing of await inventory(storageConfig.root)) {
    const current = expected.get(existing.key);
    if (!current || current.sha256 !== existing.sha256) throw new Error('The local destination contains differing or stale files. Use a new STORAGE_LOCAL_ROOT for rollback.');
  }
}
const results: Array<Entry & { result: string }> = [];
for (const entry of entries) {
  if (!apply) { results.push({ ...entry, result: 'planned' }); continue; }
  const target = toLocal ? local : remote;
  if (await target.fileExists(entry.key)) {
    const data = await target.readStorageFile(entry.key);
    if (data.length !== entry.size || createHash('sha256').update(data).digest('hex') !== entry.sha256) throw new Error(`Destination differs; refused overwrite: ${entry.key}`);
    results.push({ ...entry, result: 'already-verified' });
    continue;
  }
  if (toLocal) await local.writeStorageFile(entry.key, await remote.readStorageFile(entry.key));
  else await remote.storeLocalFile(entry.key, local.resolveStoragePath(entry.key));
  const actual = await target.readStorageFile(entry.key);
  if (actual.length !== entry.size || createHash('sha256').update(actual).digest('hex') !== entry.sha256 || (!toLocal && await digestFile(local.resolveStoragePath(entry.key)) !== entry.sha256)) throw new Error(`Migration verification failed: ${entry.key}`);
  results.push({ ...entry, result: 'copied-and-verified' });
}
await fs.writeFile(manifestPath, JSON.stringify({ mode: apply ? 'applied' : 'dry-run', createdAt: new Date().toISOString(), direction: toLocal ? 's3-to-local' : 'local-to-s3', localRoot: storageConfig.root, bucket: env.STORAGE_S3_BUCKET, prefix: env.STORAGE_S3_PREFIX, files: results }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', files: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.size, 0), copied: results.filter((entry) => entry.result === 'copied-and-verified').length, alreadyVerified: results.filter((entry) => entry.result === 'already-verified').length, manifestPath }));
