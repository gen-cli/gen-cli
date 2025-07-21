#!/usr/bin/env bun
/// <reference types="bun-types" />

interface FileSystem {
  readFile(file: string): Promise<string>;
  writeFile(file: string, content: string): Promise<void>;
  glob(pattern: string): Promise<string[]>;
}

async function createBunFileSystem(): Promise<FileSystem> {
  const { glob } = await import('glob');

  return {
    async readFile(file: string): Promise<string> {
      return await Bun.file(file).text();
    },
    async writeFile(file: string, content: string): Promise<void> {
      await Bun.write(file, content);
    },
    async glob(pattern: string): Promise<string[]> {
      return await glob(pattern);
    },
  };
}

async function createNodeFileSystem(): Promise<FileSystem> {
  const fs = await import('fs/promises');
  const { glob } = await import('glob');

  return {
    async readFile(file: string): Promise<string> {
      return await fs.readFile(file, 'utf-8');
    },
    async writeFile(file: string, content: string): Promise<void> {
      await fs.writeFile(file, content, 'utf-8');
    },
    async glob(pattern: string): Promise<string[]> {
      return await glob(pattern);
    },
  };
}

async function getFileSystem(): Promise<FileSystem> {
  try {
    return await createBunFileSystem();
  } catch (e) {
    console.log('Falling back to Node.js file system', e);
    return await createNodeFileSystem();
  }
}

async function renamePackageReferences() {
  const fs = await getFileSystem();

  // Update package.json files
  const packageFiles = [
    'packages/core/package.json',
    'packages/cli/package.json',
    'package.json',
  ];

  for (const file of packageFiles) {
    try {
      const content = await fs.readFile(file);
      const pkg = JSON.parse(content);

      if ((pkg.name as string).endsWith('core')) {
        pkg.name = '@gen-cli/gen-cli-core';
      } else if ((pkg.name as string).endsWith('cli')) {
        pkg.name = '@gen-cli/gen-cli';
        if (pkg.main && pkg.main != pkg.bin.gemini) {
          throw 'require main to be the same as bin';
        }
        pkg.bin = {
          gen: pkg.bin.gemini,
        };
      } else {
        throw `unknown pkg name in ${file}`;
      }

      pkg.description = pkg.description?.replace(/gemini/gi, 'gen');
      if (pkg.repository) {
        pkg.repository = {
          type: 'git',
          url: 'git+https://github.com/gen-cli/gen-cli.git',
        };
      }

      await fs.writeFile(file, JSON.stringify(pkg, null, 2) + '\n');
      console.log(`Updated package fields in ${file}`);
    } catch (error) {
      console.error(`Error updating ${file}:`, error);
      process.exit(1);
    }
  }
  try {
    const files = await fs.glob('packages/**/*.{ts,tsx,js,jsx,json,md}');
    let changesMade = 0;

    for (const file of files.concat('package-lock.json')) {
      const content = await fs.readFile(file);
      if (content.includes('@google/gemini-cli')) {
        const newContent = content
          .replace(/@google\/gemini-cli-core/g, '@gen-cli/gen-cli-core')
          .replace(/@google\/gemini-cli/g, '@gen-cli/gen-cli');
        await fs.writeFile(file, newContent);
        changesMade++;
        console.log(`Updated references in ${file}`);
      }
    }

    console.log(`Done. Updated ${changesMade} files.`);
  } catch (error) {
    console.error('Error during renaming:', error);
    process.exit(1);
  }
}

await renamePackageReferences();
