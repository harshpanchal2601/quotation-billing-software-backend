import { pathToFileURL } from 'node:url';

import bcrypt from 'bcrypt';
import { AccountType, FirmStatus, UserRole, UserStatus } from '@prisma/client';

import { env } from '../src/config/env.js';
import { prisma } from '../src/core/database/prisma.js';
import {
  initialAdminSeedSchema,
  platformAdminSeedSchema,
  type InitialAdminSeedInput,
  type PlatformAdminSeedInput,
} from '../src/modules/auth/auth.schema.js';
import {
  defaultBusinessProfileData,
  defaultQuotationSettingsData,
} from '../src/modules/settings/index.js';

export const defaultItemCategory = {
  name: 'Uncategorised',
  slug: 'uncategorised',
  description: 'Default category for items without a category',
} as const;

export const defaultMeasurementUnits = [
  { name: 'Number', symbol: 'NOS', allowDecimal: false },
  { name: 'Piece', symbol: 'PCS', allowDecimal: false },
  { name: 'Set', symbol: 'SET', allowDecimal: false },
  { name: 'Kilogram', symbol: 'KG', allowDecimal: true },
  { name: 'Litre', symbol: 'LTR', allowDecimal: true },
  { name: 'Metre', symbol: 'MTR', allowDecimal: true },
  { name: 'Job', symbol: 'JOB', allowDecimal: false },
] as const;

export const initialFirm = {
  name: 'Buminex Pharmtech Solutions Pvt. Ltd.',
  slug: 'buminex',
  userLimit: 4,
} as const;

type InitialAdminSeedResult = 'created' | 'already-existed';
type SingletonSeedResult = 'created' | 'already-existed';

export async function seedInitialFirm() {
  const existingFirm = await prisma.firm.findUnique({ where: { slug: initialFirm.slug } });
  if (existingFirm !== null) return existingFirm;

  return prisma.firm.create({
    data: {
      ...initialFirm,
      status: FirmStatus.ACTIVE,
    },
  });
}

export function getInitialAdminSeedInput(environment: NodeJS.ProcessEnv): InitialAdminSeedInput {
  return initialAdminSeedSchema.parse({
    name: environment.INITIAL_ADMIN_NAME,
    email: environment.INITIAL_ADMIN_EMAIL,
    username: environment.INITIAL_ADMIN_USERNAME,
    password: environment.INITIAL_ADMIN_PASSWORD,
  });
}

export function getPlatformAdminSeedInput(environment: NodeJS.ProcessEnv): PlatformAdminSeedInput | null {
  const values = {
    name: environment.PLATFORM_ADMIN_NAME,
    email: environment.PLATFORM_ADMIN_EMAIL,
    username: environment.PLATFORM_ADMIN_USERNAME,
    password: environment.PLATFORM_ADMIN_PASSWORD,
  };
  if (Object.values(values).every((value) => value === undefined || value.trim() === '')) return null;
  return platformAdminSeedSchema.parse(values);
}

export async function seedPlatformAdmin(input: PlatformAdminSeedInput | null): Promise<InitialAdminSeedResult> {
  if (input === null) return 'already-existed';
  const email = input.email.trim().toLowerCase();
  const username = input.username.trim().toLowerCase();
  const existingUser = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
  if (existingUser !== null) {
    if (existingUser.accountType !== AccountType.SUPER_ADMIN) {
      throw new Error('Platform administrator email or username belongs to a non-platform account.');
    }
    console.info('Platform administrator already exists.');
    return 'already-existed';
  }
  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_SALT_ROUNDS);
  await prisma.user.create({
    data: {
      name: input.name.trim(),
      email,
      username,
      passwordHash,
      role: UserRole.ADMIN,
      accountType: AccountType.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      passwordChangedAt: new Date(),
    },
  });
  console.info('Platform administrator created.');
  return 'created';
}

export async function seedInitialAdmin(
  input: InitialAdminSeedInput,
  firmId: number,
): Promise<InitialAdminSeedResult> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const username = input.username.trim().toLowerCase();

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email }, { username }],
    },
  });

  if (existingUser !== null) {
    console.info('Initial administrator already exists.');
    return 'already-existed';
  }

  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_SALT_ROUNDS);

  await prisma.user.create({
    data: {
      name,
      email,
      username,
      passwordHash,
      role: UserRole.ADMIN,
      accountType: AccountType.FIRM_ADMIN,
      firmId,
      status: UserStatus.ACTIVE,
      passwordChangedAt: new Date(),
    },
  });

  console.info('Initial administrator created.');
  return 'created';
}

export async function seedDefaultBusinessProfile(firmId: number): Promise<SingletonSeedResult> {
  const existingProfile = await prisma.businessProfile.findUnique({ where: { firmId } });

  if (existingProfile !== null) {
    console.info('Default business profile already exists.');
    return 'already-existed';
  }

  await prisma.businessProfile.create({
    data: { firmId, ...defaultBusinessProfileData },
  });
  console.info('Default business profile created.');
  return 'created';
}

export async function seedDefaultQuotationSettings(firmId: number): Promise<SingletonSeedResult> {
  let businessProfile = await prisma.businessProfile.findUnique({ where: { firmId } });

  if (businessProfile === null) {
    businessProfile = await prisma.businessProfile.create({
      data: { firmId, ...defaultBusinessProfileData },
    });
    console.info('Default business profile created.');
  }

  const existingSettings = await prisma.quotationSetting.findUnique({
    where: { businessProfileId: businessProfile.id },
  });

  if (existingSettings !== null) {
    console.info('Default quotation settings already exist.');
    return 'already-existed';
  }

  await prisma.quotationSetting.create({
    data: {
      businessProfileId: businessProfile.id,
      ...defaultQuotationSettingsData,
    },
  });
  console.info('Default quotation settings created.');
  return 'created';
}

export async function seed() {
  const firm = await seedInitialFirm();

  await seedPlatformAdmin(getPlatformAdminSeedInput(process.env));

  await prisma.itemCategory.upsert({
    where: {
      firmId_slug: {
        firmId: firm.id,
        slug: defaultItemCategory.slug,
      },
    },
    update: {
      name: defaultItemCategory.name,
      description: defaultItemCategory.description,
      isActive: true,
      deletedAt: null,
    },
    create: { firmId: firm.id, ...defaultItemCategory },
  });

  await Promise.all(
    defaultMeasurementUnits.map((unit) =>
      prisma.measurementUnit.upsert({
        where: {
          firmId_symbol: {
            firmId: firm.id,
            symbol: unit.symbol,
          },
        },
        update: {
          name: unit.name,
          allowDecimal: unit.allowDecimal,
          isActive: true,
          deletedAt: null,
        },
        create: { firmId: firm.id, ...unit },
      }),
    ),
  );

  await seedInitialAdmin(getInitialAdminSeedInput(process.env), firm.id);
  await seedDefaultBusinessProfile(firm.id);
  await seedDefaultQuotationSettings(firm.id);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void seed()
    .then(() => {
      console.info('Reference seed data completed.');
    })
    .catch((error: unknown) => {
      console.error('Reference seed data failed.');
      console.error(error instanceof Error ? error.message : 'Unknown seed error');
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
