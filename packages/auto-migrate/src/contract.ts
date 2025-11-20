export type ErrorKind = 'missing_table' | 'missing_column' | 'foreign_key' | 'type_mismatch' | 'invalid_default' | 'drop_blocked' | 'unknown';

export interface ClassifiedError {
  kind: ErrorKind;
  message: string;
  table?: string;
  column?: string;
  constraint?: string;
  expectedType?: string;
  providedType?: string;
}

export interface SandboxResult {
  success: boolean;
  logs: string[];
  errors?: ClassifiedError[];
  repairedSql?: string;
}

