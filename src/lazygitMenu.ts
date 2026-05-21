export type KeyedMenuItem = { key?: string; label: string };

export function decorateMenuItems<T extends KeyedMenuItem>(items: T[]): Array<T | KeyedMenuItem> {
  return [{ label: 'esc Cancel', key: '<esc>' }, ...items.map(item => ({ ...item, label: item.key ? `${item.key} ${item.label}` : item.label }))];
}

export function findMenuItemByKey<T extends KeyedMenuItem>(items: T[], typed: string): T | undefined {
  const value = typed.trim();
  if (!value) return undefined;
  return items.find(item => item.key ? keysEqual(item.key, value) : false);
}

function keysEqual(expected: string, typed: string): boolean {
  if (expected.startsWith('<') && expected.endsWith('>')) return expected.toLowerCase() === typed.toLowerCase();
  return expected === typed;
}
