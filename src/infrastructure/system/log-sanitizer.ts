const MAX_LOGGED_VALUE_LENGTH = 200;

const CONTROL_CHARS = buildControlCharRegex();

function buildControlCharRegex(): RegExp {
  const ranges = [
    [0x00, 0x08],
    [0x0b, 0x0c],
    [0x0e, 0x1f],
    [0x7f, 0x9f],
  ];

  const pattern = ranges
    .map(([start, end]) => `\\u${hex(start)}-\\u${hex(end)}`)
    .join('');

  return new RegExp(`[${pattern}]`, 'g');
}

function hex(code: number): string {
  return code.toString(16).padStart(4, '0');
}

export function sanitizeForLog(value: unknown): string {
  if (value === null || value === undefined) return String(value);

  let text = typeof value === 'string' ? value : safeStringify(value);

  text = text
    .replace(/\r\n/g, '\\r\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(CONTROL_CHARS, '');

  if (text.length > MAX_LOGGED_VALUE_LENGTH) {
    text = `${text.slice(0, MAX_LOGGED_VALUE_LENGTH)}…[truncated ${text.length} chars]`;
  }

  return text;
}

export function sanitizeLogContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!context) return undefined;

  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value instanceof Date
    ) {
      clean[key] = value;
    } else {
      clean[key] = sanitizeForLog(value);
    }
  }
  return clean;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return '[unserializable]';
  }
}
