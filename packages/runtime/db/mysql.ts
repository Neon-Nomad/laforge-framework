import mysql from 'mysql2/promise';

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escape = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (escape) {
      current += char;
      escape = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escape = true;
      continue;
    }
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      current += char;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      current += char;
      continue;
    }
    if (char === ';' && !inSingle && !inDouble) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }
    current += char;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

export class MySQLConnection {
  private pool;

  constructor(connectionUrl: string) {
    this.pool = mysql.createPool(connectionUrl);
  }

  async query(text: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
    const [rows] = await this.pool.query(text, params);
    const normalized = Array.isArray(rows) ? rows : [];
    return { rows: normalized as any[], rowCount: normalized.length };
  }

  async exec(sql: string): Promise<void> {
    const stmts = splitSqlStatements(sql);
    for (const stmt of stmts) {
      await this.pool.query(stmt);
    }
  }

  async execMany(statements: string[]): Promise<void> {
    for (const stmt of statements) {
      const parts = splitSqlStatements(stmt);
      for (const part of parts) {
        await this.pool.query(part);
      }
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
