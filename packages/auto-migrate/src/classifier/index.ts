import { ClassifiedError } from '../contract.js';

type Detector = (line: string) => ClassifiedError | null;

const missingTableRegex = /relation "(?<table>[^"]+)" does not exist/i;
const missingColumnRegex = /column "(?<column>[^"]+)" of relation "(?<table>[^"]+)" does not exist/i;
const fkViolationRegex = /violates foreign key constraint "(?<constraint>[^"]+)"/i;
const fkMissingUniqueRegex = /there is no unique constraint matching given keys for referenced table "(?<table>[^"]+)"/i;
const typeMismatchRegex =
  /column "(?<column>[^"]+)" is of type (?<expected>[a-z0-9_ ]+) but expression is of type (?<provided>[a-z0-9_ ]+)/i;
const typeDoesNotExistRegex = /type "(?<expected>[^"]+)" does not exist/i;
const invalidDefaultRegex =
  /invalid input syntax for type (?<expected>[a-z0-9_ ]+): "(?<value>[^"]*)"/i;
const invalidDefaultExprRegex =
  /column "(?<column>[^"]+)" has type (?<expected>[a-z0-9_ ]+) but default expression is of type (?<provided>[a-z0-9_ ]+)/i;
const dropBlockedRegex = /cannot drop (?:table|column) "(?<target>[^"]+)" because other objects depend on it/i;
const dropReferencedRegex = /is referenced by constraint "(?<constraint>[^"]+)"/i;

const detectors: Detector[] = [
  (line) => {
    const match = missingColumnRegex.exec(line);
    if (!match) return null;
    return {
      kind: 'missing_column',
      message: line,
      table: match.groups?.table,
      column: match.groups?.column,
    };
  },
  (line) => {
    const match = missingTableRegex.exec(line);
    if (!match) return null;
    return {
      kind: 'missing_table',
      message: line,
      table: match.groups?.table,
    };
  },
  (line) => {
    const match = fkViolationRegex.exec(line);
    if (!match) return null;
    return {
      kind: 'foreign_key',
      message: line,
      constraint: match.groups?.constraint,
    };
  },
  (line) => {
    const match = fkMissingUniqueRegex.exec(line);
    if (!match) return null;
    return {
      kind: 'foreign_key',
      message: line,
      table: match.groups?.table,
    };
  },
  (line) => {
    const match = typeMismatchRegex.exec(line);
    if (!match) return null;
    return {
      kind: 'type_mismatch',
      message: line,
      column: match.groups?.column,
      expectedType: normalizeType(match.groups?.expected),
      providedType: normalizeType(match.groups?.provided),
    };
  },
  (line) => {
    const match = typeDoesNotExistRegex.exec(line);
    if (!match) return null;
    return {
      kind: 'type_mismatch',
      message: line,
      expectedType: normalizeType(match.groups?.expected),
    };
  },
  (line) => {
    const match = invalidDefaultRegex.exec(line);
    if (!match) return null;
    return {
      kind: 'invalid_default',
      message: line,
      expectedType: normalizeType(match.groups?.expected),
    };
  },
  (line) => {
    const match = invalidDefaultExprRegex.exec(line);
    if (!match) return null;
    return {
      kind: 'invalid_default',
      message: line,
      column: match.groups?.column,
      expectedType: normalizeType(match.groups?.expected),
      providedType: normalizeType(match.groups?.provided),
    };
  },
  (line) => {
    const match = dropBlockedRegex.exec(line);
    if (!match) return null;
    return {
      kind: 'drop_blocked',
      message: line,
      table: match.groups?.target,
    };
  },
  (line) => {
    const match = dropReferencedRegex.exec(line);
    if (!match) return null;
    return {
      kind: 'drop_blocked',
      message: line,
      constraint: match.groups?.constraint,
    };
  },
];

export function classifyErrors(logs: string[]): ClassifiedError[] {
  const errors: ClassifiedError[] = [];
  const seen = new Set<string>();

  const pushError = (error: ClassifiedError) => {
    const key = serializeKey(error);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    errors.push(error);
  };

  for (const entry of logs) {
    const lines = entry.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      let matched = false;
      for (const detector of detectors) {
        const detected = detector(line);
        if (detected) {
          pushError(detected);
          matched = true;
          break;
        }
      }

      if (!matched && /\b(error|fatal)\b/i.test(line)) {
        pushError({
          kind: 'unknown',
          message: line,
        });
      }
    }
  }

  return errors;
}

function normalizeType(value?: string): string | undefined {
  if (!value) return undefined;
  return value.trim().toLowerCase();
}

function serializeKey(error: ClassifiedError): string {
  return [
    error.kind,
    error.table ?? '',
    error.column ?? '',
    error.constraint ?? '',
    error.message,
  ].join('::');
}
