import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeKmsProviderFromConfig, rotateEnc2Tokens } from '../lib/kms.js';

export function registerKmsCommand(program: Command) {
  const kms = program.command('kms').description('KMS utilities (rotation, health)');

  kms
    .command('rotate')
    .description('Rotate KMS-wrapped data keys inside enc2 tokens (wrap-only, no data decrypt)')
    .option('-t, --token <enc2>', 'enc2 token to rotate (can be provided multiple times)', (val, acc) => {
      acc.push(val);
      return acc;
    }, [] as string[])
    .option('-i, --input <file>', 'file containing enc2 tokens (one per line)')
    .option('-o, --output <file>', 'file to write rotated tokens (default: stdout)')
    .option('-p, --provider <provider>', 'kms provider (aws|azure|gcp|vault|local)')
    .option('-k, --key <key>', 'provider key identifier (keyId/keyName)')
    .option('-v, --version <version>', 'target key version to set on rotated tokens')
    .action(async opts => {
      const tokens: string[] = [...opts.token];
      if (opts.input) {
        const body = await fs.readFile(path.resolve(opts.input), 'utf8');
        body
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(Boolean)
          .forEach(t => tokens.push(t));
      }
      if (!tokens.length) {
        throw new Error('No tokens provided. Use --token or --input.');
      }
      const provider = makeKmsProviderFromConfig({ provider: opts.provider, version: opts.version, keyId: opts.key, keyName: opts.key });
      const rotated = await rotateEnc2Tokens(tokens, provider, opts.version);
      if (opts.output) {
        await fs.writeFile(path.resolve(opts.output), rotated.join('\n'), 'utf8');
      } else {
        rotated.forEach(t => console.log(t));
      }
    });
}
