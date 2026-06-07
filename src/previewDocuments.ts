import * as vscode from 'vscode';

export const EMPTY_PREVIEW_SCHEME = 'lazygitvs-empty';
export const VIRTUAL_PREVIEW_SCHEME = 'lazygitvs-preview';

export class EmptyProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(): string {
    return '';
  }
}

export class VirtualPreviewProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();

  readonly onDidChange = this.emitter.event;

  set(title: string, content: string): vscode.Uri {
    const cleanTitle = title.replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, ' ').replace(/\s+/g, ' ').trim() || 'LazyGitVS Preview';
    const fileName = `${cleanTitle.slice(0, 120)}.diff`;
    const key = Buffer.from(title).toString('base64url');
    this.contents.set(key, content);
    const uri = vscode.Uri.from({ scheme: VIRTUAL_PREVIEW_SCHEME, path: `/${fileName}`, query: key });
    this.emitter.fire(uri);
    return uri;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.query) ?? '';
  }
}
