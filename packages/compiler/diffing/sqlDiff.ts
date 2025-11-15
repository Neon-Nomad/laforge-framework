import { diffLines } from 'diff';

export function diffSql(oldSql: string, newSql: string): string {
  const changes = diffLines(oldSql, newSql);
  const lines: string[] = [];

  for (const change of changes) {
    const prefix = change.added ? '+' : change.removed ? '-' : ' ';
    const changeLines = change.value.split('\n');
    for (const line of changeLines) {
      if (line === '' && changeLines.length === 1) continue;
      if (line.length === 0) {
        lines.push(prefix);
      } else {
        lines.push(`${prefix}${line}`);
      }
    }
  }

  return lines.join('\n').trimEnd();
}
