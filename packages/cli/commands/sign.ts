import { Command } from 'commander';
import { signSnapshot } from '../lib/signing.js';
import { signSbom } from '../lib/sbom.js';

export function registerSignCommand(program: Command) {
  const sign = program.command('sign').description('Sign LaForge artifacts');

  sign
    .command('snapshot')
    .description('Sign a snapshot by id')
    .argument('<id>', 'snapshot id')
    .option('--key <path>', 'Path to Ed25519 private key PEM', '')
    .option('--pub <path>', 'Path to public key PEM (optional)', '')
    .action(async (id, opts) => {
      const entry = await signSnapshot(id, { key: opts.key || undefined, pub: opts.pub || undefined });
      console.log(JSON.stringify({ id: entry.id, signature: entry.signature, publicKey: entry.publicKey }, null, 2));
    });

  sign
    .command('sbom')
    .description('Sign the generated SBOM (.laforge/sbom/sbom.json)')
    .option('--key <path>', 'Path to Ed25519 private key PEM', '')
    .option('--pub <path>', 'Path to public key PEM (optional)', '')
    .action(async opts => {
      const result = await signSbom({ key: opts.key || undefined, pub: opts.pub || undefined });
      console.log(JSON.stringify({ signature: result.signature, publicKey: result.publicKey, signed: result.sbomPath }, null, 2));
    });
}
