/**
 * Builds conservative CSS selectors with attribute and hierarchy constraints.
 */

export function escapeCssAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export class CssBuilder {
  byId(id: string): string {
    return `#${cssEscapeIdentifier(id)}`;
  }

  byClassAndTag(tag: string, classToken: string): string {
    return `${tag}.${cssEscapeIdentifier(classToken)}`;
  }

  byAttributeEquals(tag: string, attr: string, value: string): string {
    return `${tag}[${attr}="${escapeCssAttrValue(value)}"]`;
  }

  byStartsWithAttr(tag: string, attr: string, prefix: string): string {
    return `${tag}[${attr}^="${escapeCssAttrValue(prefix)}"]`;
  }

  byContainsAttr(tag: string, attr: string, needle: string): string {
    return `${tag}[${attr}*="${escapeCssAttrValue(needle)}"]`;
  }

  byStartsWithAndEndsWithAttr(tag: string, attr: string, prefix: string, suffix: string): string {
    return `${tag}[${attr}^="${escapeCssAttrValue(prefix)}"][${attr}$="${escapeCssAttrValue(suffix)}"]`;
  }

  childDirect(parentSel: string, childSel: string): string {
    return `${parentSel} > ${childSel}`;
  }

  descendant(parentSel: string, childSel: string): string {
    return `${parentSel} ${childSel}`;
  }

  nestedScoped(parentTag: string, parentAttr: { name: string; value: string }, childSel: string): string {
    const p = `${parentTag}[${parentAttr.name}="${escapeCssAttrValue(parentAttr.value)}"]`;
    return this.descendant(p, childSel);
  }
}

/**
 * Minimal identifier escape for #id and .class (ASCII focused).
 */
function cssEscapeIdentifier(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}
