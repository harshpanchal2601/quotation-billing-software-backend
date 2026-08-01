import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const categoriesRepositoryMock = {
  listCategories: vi.fn(),
  getCategoryOptions: vi.fn(),
  findCategoryByName: vi.fn(),
  generateUniqueSlug: vi.fn(),
  createCategory: vi.fn(),
  findCategoryById: vi.fn(),
  findDeletedCategoryById: vi.fn(),
  findRestoreConflict: vi.fn(),
  countLinkedItems: vi.fn(),
  updateCategory: vi.fn(),
  updateCategoryStatus: vi.fn(),
  deleteCategory: vi.fn(),
  restoreCategory: vi.fn(),
};

vi.mock('../src/modules/categories/categories.repository.js', () => ({
  categoriesRepository: categoriesRepositoryMock,
}));

const { createCategory, listCategories, categoriesRepository } = await import(
  '../src/modules/categories/categories.routes.js',
);

function createRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('categories routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a category through the repository and keeps the success payload shape', async () => {
    vi.mocked(categoriesRepository.findCategoryByName).mockResolvedValueOnce(null as never);
    vi.mocked(categoriesRepository.generateUniqueSlug).mockResolvedValueOnce('vessels-reactors');
    vi.mocked(categoriesRepository.createCategory).mockResolvedValueOnce({ id: 1, name: 'Vessels & Reactors' } as never);

    const req = {
      body: { name: 'Vessels & Reactors', description: 'Category', isActive: true },
      user: { id: 7 },
      ip: '127.0.0.1',
      get: vi.fn().mockReturnValue('vitest'),
    } as unknown as Request;
    const res = createRes();

    await createCategory(req, res);

    expect(categoriesRepository.createCategory).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'vessels-reactors' }),
      expect.objectContaining({ userId: 7 }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'Category created successfully',
      }),
    );
  });

  it('rejects a duplicate category name before create', async () => {
    vi.mocked(categoriesRepository.findCategoryByName).mockResolvedValueOnce({ id: 1 } as never);

    const req = {
      body: { name: 'Existing', isActive: true },
      user: { id: 7 },
      ip: '127.0.0.1',
      get: vi.fn(),
    } as unknown as Request;
    const res = createRes();

    await expect(createCategory(req, res)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Category with this name already exists',
    });
  });

  it('returns the category list payload from the repository', async () => {
    vi.mocked(categoriesRepository.listCategories).mockResolvedValueOnce({
      categories: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false },
    } as never);

    const req = { query: {} } as Request;
    const res = createRes();

    await listCategories(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Categories retrieved successfully',
      }),
    );
  });
});