import type { LazyGitKeymap } from './lazygitConfig';

type UniversalKeymap = LazyGitKeymap['universal'];

export type PanelBlockNavigationBindings = {
  previous: string[];
  next: string[];
};

function asBindings(...values: Array<string | string[] | undefined>): string[] {
  return values.flatMap(value => Array.isArray(value) ? value : value ? [value] : []);
}

function keysEqual(expected: string, typed: string): boolean {
  if (expected.startsWith('<') && expected.endsWith('>')) return expected.toLowerCase() === typed.toLowerCase();
  return expected === typed;
}

export function panelBlockNavigationBindings(universal: UniversalKeymap): PanelBlockNavigationBindings {
  return {
    previous: asBindings(universal.prevBlock, universal.prevBlockAlt, universal.prevBlockAlt2),
    next: asBindings(universal.nextBlock, universal.nextBlockAlt, universal.nextBlockAlt2)
  };
}

export function panelBlockNavigationDelta(key: string, universal: UniversalKeymap): -1 | 1 | undefined {
  const bindings = panelBlockNavigationBindings(universal);
  if (bindings.previous.some(binding => keysEqual(binding, key))) return -1;
  if (bindings.next.some(binding => keysEqual(binding, key))) return 1;
  return undefined;
}
