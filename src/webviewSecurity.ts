import * as vscode from 'vscode';

export type WebviewMessage = {
  type: string;
  [key: string]: any;
};

export const allowedMessageTypes = new Set([
  'focusArea',
  'commandPalette',
  'move',
  'moveTo',
  'rangeToggle',
  'rangeMove',
  'select',
  'switchPanel',
  'toggle',
  'enter',
  'openDiff',
  'openFile',
  'editFile',
  'copyPath',
  'copyInfo',
  'ignoreMenu',
  'fetch',
  'statusMenu',
  'repoMenu',
  'helpMenu',
  'commitAction',
  'panelAction',
  'moveBlock',
  'focusMainView',
  'stageAll',
  'commit',
  'commitNoVerify',
  'amendLastCommit',
  'commitWithEditor',
  'push',
  'pull',
  'pushMenu',
  'pullMenu',
  'stashAll',
  'stashMenu',
  'discardMenu',
  'resetMenu',
  'search',
  'clearFilter',
  'statusFilter',
  'diffingMenu',
  'refresh',
  'close',
  'back',
  'togglePanel',
  'toggleHunkSelection'
]);

export function normalizeWebviewMessage(value: unknown): WebviewMessage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const message = value as Record<string, unknown>;
  if (typeof message.type !== 'string') return undefined;
  if (!allowedMessageTypes.has(message.type)) return undefined;
  return message as WebviewMessage;
}

export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029' }[c]!));
}

export function webviewContentSecurityPolicy(webview: vscode.Webview, nonce: string): string {
  return `default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
}
