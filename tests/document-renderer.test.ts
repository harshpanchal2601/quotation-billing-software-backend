import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { renderAndStorePdf } from '../src/integrations/documents/index.js';
const providers = vi.hoisted(() => ({ render: vi.fn(), write: vi.fn(), remove: vi.fn() }));
vi.mock('../src/integrations/pdf/index.js', () => ({ pdfService: { generateBufferFromHtml: providers.render } }));
vi.mock('../src/integrations/storage/index.js', () => ({ storageService: { writeStorageFile: providers.write, deleteStorageFile: providers.remove } }));
beforeEach(() => { vi.resetAllMocks(); providers.remove.mockResolvedValue(undefined); });
describe('shared document provider composition', () => {
  it('keeps the same provider buffer, storage metadata and hash', async () => {
    const buffer = Buffer.from('fixture-pdf'); providers.render.mockResolvedValue(buffer);
    await expect(renderAndStorePdf('<html/>', 'quotations/1/x.pdf')).resolves.toEqual({ filePath: 'quotations/1/x.pdf', fileSize: buffer.length, fileHash: createHash('sha256').update(buffer).digest('hex') });
    expect(providers.write).toHaveBeenCalledWith('quotations/1/x.pdf', buffer);
  });
  it('writes nothing after a render crash and allows recovery', async () => {
    providers.render.mockRejectedValueOnce(new Error('renderer unavailable')).mockResolvedValue(Buffer.from('ok'));
    await expect(renderAndStorePdf('', 'x.pdf')).rejects.toThrow('renderer unavailable');
    expect(providers.write).not.toHaveBeenCalled();
    await expect(renderAndStorePdf('', 'x.pdf')).resolves.toMatchObject({ fileSize: 2 });
  });
  it('cleans partial storage writes and permits a clean retry', async () => {
    providers.render.mockResolvedValue(Buffer.from('ok'));
    providers.write.mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    await expect(renderAndStorePdf('', 'x.pdf')).rejects.toThrow('disk full');
    expect(providers.remove).toHaveBeenCalledWith('x.pdf');
    await expect(renderAndStorePdf('', 'x.pdf')).resolves.toMatchObject({ fileSize: 2 });
  });
});
