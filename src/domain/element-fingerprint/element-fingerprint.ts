import type * as cheerio from 'cheerio';
import type { Element } from 'domhandler';

export interface ElementFingerprint {
  tag: string;
  attributes: Record<string, string>;
  text: string;
  normalizedText: string;
  position?: { index: number; depth: number };
  parentHierarchy: string[];
  boundingHints?: {
    role?: string;
    name?: string;
  };
}

function getElement(node: cheerio.Cheerio<Element>): Element | null {
  const n = node.get(0);
  return n ?? null;
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 512);
}

export function fingerprintFromCheerio(node: cheerio.Cheerio<Element>): ElementFingerprint | null {
  const el = getElement(node);
  if (!el || el.type !== 'tag') return null;

  const tag = el.name.toLowerCase();
  const attributes: Record<string, string> = {};
  if (el.attribs) {
    for (const [k, v] of Object.entries(el.attribs)) {
      attributes[k.toLowerCase()] = String(v);
    }
  }

  const text = node.text();
  const parentHierarchy: string[] = [];
  node
    .parents()
    .slice(0, 8)
    .each((_i, p) => {
      if (p.type === 'tag') parentHierarchy.push(p.name.toLowerCase());
    });

  const role = attributes['role'];
  const aria = attributes['aria-label'] ?? attributes['aria-labelledby'];
  const name = aria ?? attributes['title'];

  return {
    tag,
    attributes,
    text,
    normalizedText: normalizeText(text),
    parentHierarchy,
    boundingHints: {
      role: role,
      name: name ? String(name).slice(0, 200) : undefined,
    },
  };
}

export function fingerprintFromUnknownPayload(input: unknown): ElementFingerprint | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const tag = typeof o.tag === 'string' ? o.tag : 'unknown';
  const attributes =
    o.attributes && typeof o.attributes === 'object'
      ? Object.fromEntries(
          Object.entries(o.attributes as Record<string, unknown>).map(([k, v]) => [String(k), String(v)]),
        )
      : {};
  const text = typeof o.text === 'string' ? o.text : '';
  const position = o.position && typeof o.position === 'object' ? (o.position as ElementFingerprint['position']) : undefined;
  const parentHierarchy = Array.isArray(o.parentHierarchy)
    ? o.parentHierarchy.map((x) => String(x))
    : [];

  return {
    tag,
    attributes,
    text,
    normalizedText: normalizeText(text),
    position,
    parentHierarchy,
    boundingHints: undefined,
  };
}
