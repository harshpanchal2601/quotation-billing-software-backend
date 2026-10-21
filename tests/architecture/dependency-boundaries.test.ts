import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceDir = path.join(rootDir, 'src');

type SourceFile = {
  absolutePath: string;
  relativePath: string;
  source: string;
  imports: string[];
};

function walkTypescriptFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTypescriptFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(absolutePath);
    }
  }

  return files;
}

function normalisePath(filePath: string) {
  return filePath.split(path.sep).join('/');
}

function readSourceFiles(): SourceFile[] {
  return walkTypescriptFiles(sourceDir).map((absolutePath) => {
    const source = fs.readFileSync(absolutePath, 'utf8');
    const imports = [...source.matchAll(/\bimport\s+(?:type\s+)?(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g)].map(
      (match) => match[1] ?? '',
    );

    return {
      absolutePath,
      relativePath: normalisePath(path.relative(rootDir, absolutePath)),
      source,
      imports,
    };
  });
}

function resolveImportPath(file: SourceFile, importPath: string) {
  if (!importPath.startsWith('.')) return importPath;
  return normalisePath(path.normalize(path.join(path.dirname(file.relativePath), importPath)));
}

function expectNoViolations(violations: string[]) {
  expect(violations, violations.join('\n')).toEqual([]);
}

describe('architecture dependency boundaries', () => {
  const files = readSourceFiles();

  it('keeps core, config, and integrations independent from business modules', () => {
    const violations = files
      .filter((file) =>
        file.relativePath.startsWith('src/core/') ||
        file.relativePath.startsWith('src/config/') ||
        file.relativePath.startsWith('src/integrations/'),
      )
      .flatMap((file) =>
        file.imports
          .map((importPath) => resolveImportPath(file, importPath))
          .filter((resolved) => resolved.includes('src/modules/'))
          .map((resolved) => `${file.relativePath} imports ${resolved}`),
      );

    expectNoViolations(violations);
  });

  it('keeps raw Prisma access out of route files', () => {
    const violations = files
      .filter((file) => file.relativePath.endsWith('.routes.ts'))
      .flatMap((file) => {
        const fileViolations: string[] = [];
        if (file.imports.some((importPath) => resolveImportPath(file, importPath).includes('core/database/prisma'))) {
          fileViolations.push(`${file.relativePath} imports the Prisma client`);
        }
        if (/\bprisma\.|\$transaction|\$queryRaw|\$executeRaw/.test(file.source)) {
          fileViolations.push(`${file.relativePath} contains raw database access`);
        }
        return fileViolations;
      });

    expectNoViolations(violations);
  });

  it('keeps repositories free of Express imports and schemas free of persistence workflow', () => {
    const repositoryViolations = files
      .filter((file) => file.relativePath.endsWith('.repository.ts'))
      .flatMap((file) =>
        file.imports
          .filter((importPath) => importPath === 'express')
          .map((importPath) => `${file.relativePath} imports ${importPath}`),
      );

    const schemaViolations = files
      .filter((file) => file.relativePath.endsWith('.schema.ts'))
      .flatMap((file) =>
        file.imports
          .map((importPath) => resolveImportPath(file, importPath))
          .filter(
            (resolved) =>
              resolved.includes('core/database/prisma') ||
              resolved.endsWith('.repository.js') ||
              resolved.includes('/integrations/'),
          )
          .map((resolved) => `${file.relativePath} imports ${resolved}`),
      );

    expectNoViolations([...repositoryViolations, ...schemaViolations]);
  });

  it('keeps provider mechanics in their integrations and environment reads in config', () => {
    const violations = files.flatMap((file) => {
      const fileViolations: string[] = [];
      const importsNodemailer = file.imports.includes('nodemailer');
      const importsPuppeteer = file.imports.includes('puppeteer');
      if (importsNodemailer && !file.relativePath.startsWith('src/integrations/mail/')) {
        fileViolations.push(`${file.relativePath} imports nodemailer`);
      }
      if (importsPuppeteer && !file.relativePath.startsWith('src/integrations/pdf/')) {
        fileViolations.push(`${file.relativePath} imports puppeteer`);
      }
      if (file.source.includes('process.env') && file.relativePath !== 'src/config/env.ts') {
        fileViolations.push(`${file.relativePath} reads process.env`);
      }
      return fileViolations;
    });

    expectNoViolations(violations);
  });

  it('keeps module public exports narrow and rejected architecture folders absent', () => {
    const exportViolations = files
      .filter((file) => /^src\/modules\/[^/]+\/index\.ts$/.test(file.relativePath))
      .filter((file) => /\bexport\s+\*/.test(file.source))
      .map((file) => `${file.relativePath} uses export *`);

    const rejectedFolders = [
      'src/controllers',
      'src/services',
      'src/templates',
      'src/validators',
      'src/core/auth',
      'src/core/mail',
      'src/core/storage',
      'src/modules/business-settings',
    ];
    const folderViolations = rejectedFolders
      .filter((folder) => fs.existsSync(path.join(rootDir, folder)))
      .map((folder) => `${folder} still exists`);

    expectNoViolations([...exportViolations, ...folderViolations]);
  });
});
