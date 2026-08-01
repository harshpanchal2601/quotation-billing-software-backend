import { pathToFileURL } from 'node:url';

import bcrypt from 'bcrypt';
import { UserRole, UserStatus } from '@prisma/client';

import { env } from '../src/config/env.js';
import { prisma } from '../src/core/database/prisma.js';
import {
  initialAdminSeedSchema,
  type InitialAdminSeedInput,
} from '../src/modules/auth/auth.schema.js';
import {
  defaultBusinessProfileData,
  defaultQuotationSettingsData,
} from '../src/modules/business-settings/business-settings.defaults.js';

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

type InitialAdminSeedResult = 'created' | 'already-existed';
type SingletonSeedResult = 'created' | 'already-existed';

export function getInitialAdminSeedInput(environment: NodeJS.ProcessEnv): InitialAdminSeedInput {
  return initialAdminSeedSchema.parse({
    name: environment.INITIAL_ADMIN_NAME,
    email: environment.INITIAL_ADMIN_EMAIL,
    username: environment.INITIAL_ADMIN_USERNAME,
    password: environment.INITIAL_ADMIN_PASSWORD,
  });
}

export async function seedInitialAdmin(
  input: InitialAdminSeedInput,
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
      status: UserStatus.ACTIVE,
      passwordChangedAt: new Date(),
    },
  });

  console.info('Initial administrator created.');
  return 'created';
}

export async function seedDefaultBusinessProfile(): Promise<SingletonSeedResult> {
  const existingProfile = await prisma.businessProfile.findFirst({ orderBy: { id: 'asc' } });

  if (existingProfile !== null) {
    console.info('Default business profile already exists.');
    return 'already-existed';
  }

  await prisma.businessProfile.create({
    data: defaultBusinessProfileData,
  });
  console.info('Default business profile created.');
  return 'created';
}

export async function seedDefaultQuotationSettings(): Promise<SingletonSeedResult> {
  let businessProfile = await prisma.businessProfile.findFirst({ orderBy: { id: 'asc' } });

  if (businessProfile === null) {
    businessProfile = await prisma.businessProfile.create({
      data: defaultBusinessProfileData,
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
  await prisma.itemCategory.upsert({
    where: { slug: defaultItemCategory.slug },
    update: {
      name: defaultItemCategory.name,
      description: defaultItemCategory.description,
      isActive: true,
      deletedAt: null,
    },
    create: defaultItemCategory,
  });

  await Promise.all(
    defaultMeasurementUnits.map((unit) =>
      prisma.measurementUnit.upsert({
        where: { symbol: unit.symbol },
        update: {
          name: unit.name,
          allowDecimal: unit.allowDecimal,
          isActive: true,
          deletedAt: null,
        },
        create: unit,
      }),
    ),
  );

  await seedInitialAdmin(getInitialAdminSeedInput(process.env));
  await seedDefaultBusinessProfile();
  await seedDefaultQuotationSettings();
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
