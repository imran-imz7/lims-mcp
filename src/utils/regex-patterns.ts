/** Patterns used to flag unstable dynamic attribute values. */
export const UNSTABLE_VALUE_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'uuid', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i },
  { name: 'hex-hash-32', re: /\b[0-9a-f]{32}\b/i },
  { name: 'hex-hash-40', re: /\b[0-9a-f]{40}\b/i },
  { name: 'base64-chunk', re: /\b[A-Za-z0-9+/]{20,}={0,2}\b/ },
  { name: 'timestamp-ms', re: /\b1[3-9]\d{12}\b/ },
  { name: 'timestamp-sec', re: /\b1[3-9]\d{9}\b/ },
  { name: 'react-synthetic-id', re: /^:r[a-z0-9]+:$/i },
  { name: 'numeric-suffix', re: /[_-]\d{4,}$/ },
];
