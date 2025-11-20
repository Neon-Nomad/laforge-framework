import { Command } from 'commander';
import { signSnapshot } from '../lib/signing.js';

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
}
