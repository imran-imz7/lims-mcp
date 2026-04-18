/**
 * Builds relative, readable XPath fragments without absolute /html/body/... chains.
 */

export function escapeXPathLiteral(lit: string): string {
  if (!lit.includes("'")) return `'${lit}'`;
  if (!lit.includes('"')) return `"${lit}"`;
  const parts = lit.split("'").map((p) => `"${p}"`);
  return `concat(${parts.join(", \"'\", ")})`;
}

export class XPathBuilder {
  byTag(tag: string): string {
    return `//${tag}`;
  }

  byAttributeEquals(tag: string, attr: string, value: string): string {
    return `//${tag}[@${attr}=${escapeXPathLiteral(value)}]`;
  }

  byContainsAttr(tag: string, attr: string, value: string): string {
    return `//${tag}[contains(@${attr}, ${escapeXPathLiteral(value)})]`;
  }

  byStartsWithAttr(tag: string, attr: string, value: string): string {
    return `//${tag}[starts-with(@${attr}, ${escapeXPathLiteral(value)})]`;
  }

  byStartsWithAndEndsLike(tag: string, attr: string, prefix: string, suffix: string): string {
    const p = escapeXPathLiteral(prefix);
    const s = escapeXPathLiteral(suffix);
    return `//${tag}[starts-with(@${attr}, ${p}) and contains(@${attr}, ${s})]`;
  }

  byNormalizedText(tag: string, text: string): string {
    const lit = escapeXPathLiteral(text.trim());
    return `//${tag}[normalize-space(.)=${lit}]`;
  }

  byContainsText(tag: string, text: string): string {
    return `//${tag}[contains(normalize-space(.), ${escapeXPathLiteral(text.trim())})]`;
  }

  byContainsAllTokens(tag: string, tokens: string[]): string {
    if (!tokens.length) return `//${tag}`;
    const checks = tokens.map((t) => `contains(normalize-space(.), ${escapeXPathLiteral(t.trim())})`);
    return `//${tag}[${checks.join(' and ')}]`;
  }

  byRole(role: string, options?: { name?: string }): string {
    const base = `//*[@role=${escapeXPathLiteral(role)}]`;
    if (!options?.name) return base;
    return `//*[@role=${escapeXPathLiteral(role)}][contains(normalize-space(.), ${escapeXPathLiteral(options.name)})]`;
  }

  followingInputAfterLabelText(labelText: string): string {
    const lit = escapeXPathLiteral(labelText.trim());
    return `//label[normalize-space(.)=${lit}]/following::input[1]`;
  }

  descendantOfAncestor(descendantTag: string, ancestorTag: string, ancestorAttr?: { name: string; value: string }): string {
    if (!ancestorAttr) {
      return `//${ancestorTag}//${descendantTag}`;
    }
    return `//${ancestorTag}[@${ancestorAttr.name}=${escapeXPathLiteral(ancestorAttr.value)}]//${descendantTag}`;
  }

  followingSibling(tag: string, siblingIndex = 1): string {
    return `./following-sibling::${tag}[${siblingIndex}]`;
  }

  /** Prefer short chain: nearest section-like ancestor + target tag with attr */
  shortChain(params: { segment: string; tail: string }): string {
    return `//${params.segment}//${params.tail}`;
  }
}
