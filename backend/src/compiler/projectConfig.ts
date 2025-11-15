
import { ForgeConfig } from './types';
// In a real Node.js environment, you would use dynamic import
// import path from 'path';
// import fs from 'fs';

/**
 * Loads and validates the forge.config.ts file.
 * In this simulated environment, it returns a hardcoded config.
 */
export async function loadConfig(): Promise<ForgeConfig> {
  // const configPath = path.resolve(process.cwd(), 'forge.config.ts');
  // if (!fs.existsSync(configPath)) {
  //   throw new Error('forge.config.ts not found in the project root.');
  // }
  // const configModule = await import(configPath);
  // const config = configModule.default;

  const config: ForgeConfig = {
    domain: ['./examples/blog/domain.ts'],
    outDir: "generated",
    db: "postgres",
    dialect: "postgres-rds",
    audit: true,
    multiTenant: true,
  };

  if (!config) {
    throw new Error('forge.config.ts must have a default export.');
  }
  if (!config.outDir) {
    throw new Error('`outDir` is not defined in forge.config.ts');
  }
  if (!config.domain || !Array.isArray(config.domain) || config.domain.length === 0) {
    throw new Error('`domain` must be an array of file paths in forge.config.ts');
  }

  return config;
}
