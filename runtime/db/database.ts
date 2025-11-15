import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

export class DatabaseConnection {
  private db: Database.Database;

  constructor(filename: string = ':memory:') {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    
    // Add UUID function for SQLite
    this.db.function('uuid_generate_v4', () => uuidv4());
    this.db.function('now', () => new Date().toISOString());
  }

  // Mimic PostgreSQL's query interface for compatibility with generated code
  async query(text: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
    try {
      // Convert PostgreSQL $1, $2 placeholders to SQLite ? placeholders
      const sqliteQuery = text.replace(/\$(\d+)/g, '?');
      
      // Determine if this is a SELECT or INSERT/UPDATE/DELETE
      const isSelect = sqliteQuery.trim().toUpperCase().startsWith('SELECT');
      const isInsert = sqliteQuery.trim().toUpperCase().startsWith('INSERT');
      const isReturning = sqliteQuery.toUpperCase().includes('RETURNING');

      if (isSelect || isReturning) {
        const stmt = this.db.prepare(sqliteQuery.replace(/RETURNING \*/g, ''));
        let rows: any[];
        
        if (isInsert && isReturning) {
          // For INSERT ... RETURNING, we need to execute and then SELECT the last row
          const insertQuery = sqliteQuery.split('RETURNING')[0].trim();
          const stmt = this.db.prepare(insertQuery);
          const info = stmt.run(...params);
          
          // Get the inserted row
          const tableName = this.extractTableName(insertQuery);
          const selectStmt = this.db.prepare(`SELECT * FROM ${tableName} WHERE rowid = ?`);
          rows = [selectStmt.get(info.lastInsertRowid)];
        } else {
          rows = stmt.all(...params);
        }
        
        return {
          rows: rows || [],
          rowCount: rows?.length || 0
        };
      } else {
        // INSERT/UPDATE/DELETE
        const stmt = this.db.prepare(sqliteQuery);
        const info = stmt.run(...params);
        
        return {
          rows: [],
          rowCount: info.changes
        };
      }
    } catch (error: any) {
      console.error('Database query error:', error.message);
      console.error('Query:', text);
      console.error('Params:', params);
      throw error;
    }
  }

  private extractTableName(query: string): string {
    const match = query.match(/INTO\s+(\w+)/i);
    return match ? match[1] : '';
  }

  // Execute raw SQL (for migrations)
  exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }

  // Transaction support
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

// Create a global database instance
let globalDb: DatabaseConnection | null = null;

export function getDatabase(): DatabaseConnection {
  if (!globalDb) {
    globalDb = new DatabaseConnection(':memory:');
  }
  return globalDb;
}

export function closeDatabase(): void {
  if (globalDb) {
    globalDb.close();
    globalDb = null;
  }
}
