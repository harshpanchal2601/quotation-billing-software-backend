import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.PORT = '5000';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/buminex_quotation';
process.env.JWT_ACCESS_SECRET = 'access-secret';
process.env.JWT_REFRESH_SECRET = 'refresh-secret';
process.env.BCRYPT_SALT_ROUNDS = '10';

vi.mock('../src/core/database/prisma.js', () => ({
  prisma: {
    firm: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    itemCategory: {
      upsert: vi.fn(),
    },
    measurementUnit: {
      upsert: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    $disconnect: vi.fn(),
  },
}));

const {
  defaultItemCategory,
  defaultMeasurementUnits,
  getInitialAdminSeedInput,
  initialFirm,
  seedInitialFirm,
  seedInitialAdmin,
} = await import('../prisma/seed.js');
const { prisma } = await import('../src/core/database/prisma.js');

describe('seed reference data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defines the default uncategorised item category', () => {
    expect(defaultItemCategory).toEqual({
      name: 'Uncategorised',
      slug: 'uncategorised',
      description: 'Default category for items without a category',
    });
  });

  it('defines the expected measurement units', () => {
    expect(defaultMeasurementUnits).toEqual([
      { name: 'Number', symbol: 'NOS', allowDecimal: false },
      { name: 'Piece', symbol: 'PCS', allowDecimal: false },
      { name: 'Set', symbol: 'SET', allowDecimal: false },
      { name: 'Kilogram', symbol: 'KG', allowDecimal: true },
      { name: 'Litre', symbol: 'LTR', allowDecimal: true },
      { name: 'Metre', symbol: 'MTR', allowDecimal: true },
      { name: 'Job', symbol: 'JOB', allowDecimal: false },
    ]);
  });

  it('creates the initial firm with the four-account limit', async () => {
    vi.mocked(prisma.firm.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.firm.create).mockResolvedValueOnce({
      id: 1,
      ...initialFirm,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });

    await expect(seedInitialFirm()).resolves.toMatchObject(initialFirm);
    expect(prisma.firm.create).toHaveBeenCalledWith({
      data: {
        ...initialFirm,
        status: 'ACTIVE',
      },
    });
  });
});

describe('initial administrator seed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads and validates administrator seed values from the environment', () => {
    expect(
      getInitialAdminSeedInput({
        INITIAL_ADMIN_NAME: ' Buminex Admin ',
        INITIAL_ADMIN_EMAIL: 'Admin@Example.com',
        INITIAL_ADMIN_USERNAME: 'Admin.User',
        INITIAL_ADMIN_PASSWORD: 'StrongPass1!',
      }),
    ).toEqual({
      name: 'Buminex Admin',
      email: 'Admin@Example.com',
      username: 'Admin.User',
      password: 'StrongPass1!',
    });
  });

  it('creates the administrator with normalised identity and hashed password', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);

    const result = await seedInitialAdmin({
      name: ' Buminex Admin ',
      email: 'Admin@Example.com',
      username: 'Admin.User',
      password: 'StrongPass1!',
    }, 1);

    expect(result).toBe('created');
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ email: 'admin@example.com' }, { username: 'admin.user' }],
      },
    });
    expect(prisma.user.create).toHaveBeenCalledOnce();

    const createCall = vi.mocked(prisma.user.create).mock.calls[0]?.[0];
    expect(createCall?.data).toMatchObject({
      name: 'Buminex Admin',
      email: 'admin@example.com',
      username: 'admin.user',
      role: 'ADMIN',
      accountType: 'FIRM_ADMIN',
      firmId: 1,
      status: 'ACTIVE',
    });
    expect(createCall?.data.passwordHash).not.toBe('StrongPass1!');
    expect(createCall?.data.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('does not reset an existing administrator password', async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
      id: 1,
      name: 'Existing Admin',
      email: 'admin@example.com',
      username: 'admin',
      passwordHash: 'existing-hash',
      role: 'ADMIN',
      accountType: 'FIRM_ADMIN',
      firmId: 1,
      firmRoleId: null,
      status: 'ACTIVE',
      mustChangePassword: false,
      lastLoginAt: null,
      passwordChangedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });

    await expect(
      seedInitialAdmin({
        name: 'Buminex Admin',
        email: 'admin@example.com',
        username: 'admin',
        password: 'StrongPass1!',
      }, 1),
    ).resolves.toBe('already-existed');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});
