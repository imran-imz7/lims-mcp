import type { LocatorStrategy } from '../contracts/types.js';
import type { AttributeStabilityAnalyzer } from '../attribute-stability/attribute-stability-analyzer.js';

/**
 * Shared heuristics for strategy prioritization and rejection messaging.
 */
export class HeuristicsEngine {
  constructor(private readonly stability: AttributeStabilityAnalyzer) {}

  strategyPriority(): LocatorStrategy[] {
    return ['hybrid', 'role', 'xpath', 'css', 'relative', 'text', 'accessibility', 'playwright-codegen', 'appium'];
  }

  attributeAcceptable(name: string, value: string): boolean {
    const r = this.stability.analyzeNameAndValue(name, value);
    return r.clazz !== 'UNSTABLE';
  }

  rejectionMessage(locator: string, reason: string): string {
    return `Rejected "${locator.slice(0, 180)}": ${reason}`;
  }
}
