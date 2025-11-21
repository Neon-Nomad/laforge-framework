import { Command } from 'commander';
import { listAuditEntries, tailAuditEntries, getAuditEntryById, type AuditFilters } from '../lib/auditStore.js';

function parseFilters(opts: any): AuditFilters {
  return {
    tenant: opts.tenant,
    model: opts.model,
    action: opts.action,
    type: opts.type,
    user: opts.user,
    since: opts.since,
  };
}

function formatEntry(entry: any, format: 'json' | 'text'): string {
  if (format === 'json') return JSON.stringify(entry, null, 2);
  const parts = [
    `${entry.timestamp}`,
    entry.tenantId ? `tenant=${entry.tenantId}` : '',
    entry.userId ? `user=${entry.userId}` : '',
    entry.model ? `model=${entry.model}` : '',
    `type=${entry.type}`,
    entry.id,
  ].filter(Boolean);
  return parts.join(' | ');
}

async function printEntries(entries: any[], format: 'json' | 'text') {
  if (format === 'json') {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  for (const entry of entries) {
    console.log(formatEntry(entry, format));
  }
}

export function registerAuditCommand(program: Command) {
  const audit = program.command('audit').description('Inspect audit trail');

  audit
    .command('tail')
    .description('Show the most recent audit entries')
    .option('--tenant <tenant>', 'Filter by tenant')
    .option('--model <model>', 'Filter by model')
    .option('--action <action>', 'Filter by action/type')
    .option('--type <type>', 'Filter by audit type (e.g., decrypt, pii_reveal_denied)')
    .option('--user <user>', 'Filter by user id')
    .option('--since <since>', 'Filter since time (e.g., 1h, 30m, ISO)')
    .option('-n, --limit <limit>', 'Number of entries', '20')
    .option('-o, --output <output>', 'Output format: text|json', 'text')
    .action(async opts => {
      const filters = parseFilters(opts);
      const limit = Number(opts.limit) || 20;
      const entries = await tailAuditEntries(filters, { limit });
      await printEntries(entries, opts.output === 'json' ? 'json' : 'text');
    });

  audit
    .command('list')
    .description('List audit entries with filters')
    .option('--tenant <tenant>', 'Filter by tenant')
    .option('--model <model>', 'Filter by model')
    .option('--action <action>', 'Filter by action/type')
    .option('--type <type>', 'Filter by audit type (e.g., decrypt, pii_reveal_denied)')
    .option('--user <user>', 'Filter by user id')
    .option('--since <since>', 'Filter since time (e.g., 1h, 30m, ISO)')
    .option('-n, --limit <limit>', 'Number of entries', '100')
    .option('-o, --output <output>', 'Output format: text|json', 'text')
    .action(async opts => {
      const filters = parseFilters(opts);
      const limit = Number(opts.limit) || 100;
      const entries = await listAuditEntries(filters, { limit });
      await printEntries(entries, opts.output === 'json' ? 'json' : 'text');
    });

  audit
    .command('inspect <id>')
    .description('Inspect a single audit entry')
    .option('-o, --output <output>', 'Output format: text|json', 'text')
    .action(async (id, opts) => {
      const entry = await getAuditEntryById(id);
      if (!entry) {
        console.error(`Audit entry not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      await printEntries([entry], opts.output === 'json' ? 'json' : 'text');
    });
}
