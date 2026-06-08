export type PatchPreviewMeta = {
  title: string;
  subtitle?: string;
  hash?: string;
  subject?: string;
  author?: string;
  relativeDate?: string;
};

type FileSection = {
  title: string;
  meta: string[];
  lines: string[];
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

function lineClass(line: string): string {
  if (line.startsWith('@@')) return 'diff-hunk';
  if (line.startsWith('+') && !line.startsWith('+++')) return 'diff-add';
  if (line.startsWith('-') && !line.startsWith('---')) return 'diff-del';
  if (/^(diff --git|index |--- |\+\+\+|new file mode|deleted file mode|rename from|rename to|similarity index)/.test(line)) return 'diff-meta';
  return 'diff-context';
}

function splitPatch(patch: string): { header: string[]; stats: string[]; files: FileSection[] } {
  const lines = patch.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').split(/\r?\n/);
  const header: string[] = [];
  const stats: string[] = [];
  const files: FileSection[] = [];
  let current: FileSection | undefined;
  let seenDiff = false;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      seenDiff = true;
      const match = line.match(/^diff --git a\/(.*) b\/(.*)$/);
      current = { title: match ? (match[1] === match[2] ? match[2] : `${match[1]} → ${match[2]}`) : line.replace(/^diff --git\s+/, ''), meta: [line], lines: [] };
      files.push(current);
      continue;
    }
    if (current) {
      if (/^(index |--- |\+\+\+|new file mode|deleted file mode|rename from|rename to|similarity index)/.test(line)) current.meta.push(line);
      else if (line.length) current.lines.push(line);
      continue;
    }
    if (!seenDiff && (/^commit\s/.test(line) || /^Author:/.test(line) || /^Date:/.test(line) || /^    /.test(line))) header.push(line);
    else if (line.trim()) stats.push(line);
  }
  return { header, stats, files };
}

function renderPatchLine(line: string): string {
  return `<div class="diff-line ${lineClass(line)}"><span class="diff-prefix">${escapeHtml(line.slice(0, 1) || ' ')}</span><span class="diff-text">${escapeHtml(line)}</span></div>`;
}

type StatRow = { file: string; count: string; plus: string; minus: string };

function parseStatLine(line: string): StatRow | undefined {
  const match = line.match(/^\s*(.+?)\s+\|\s+(\d+)\s+([+-]+)\s*$/);
  if (!match) return undefined;
  const marks = match[3];
  return {
    file: match[1],
    count: match[2],
    plus: marks.replace(/-/g, ''),
    minus: marks.replace(/\+/g, '')
  };
}

function renderStats(lines: string[]): string {
  if (!lines.length) return '';
  const rows: StatRow[] = [];
  const totals: string[] = [];
  const raw: string[] = [];
  for (const line of lines) {
    const row = parseStatLine(line);
    if (row) rows.push(row);
    else if (/^\s*\d+\s+files? changed/.test(line)) totals.push(line.trim());
    else if (line.trim() === '---') continue;
    else raw.push(line);
  }
  if (!rows.length) return `<section class="stats"><h2>Summary</h2>${lines.map(line => `<div>${escapeHtml(line)}</div>`).join('')}</section>`;
  return `<section class="stats"><h2>Summary</h2><div class="stats-list">${rows.map(row => `
    <div class="stat-row">
      <span class="stat-file">${escapeHtml(row.file)}</span>
      <span class="stat-count">${escapeHtml(row.count)}</span>
      <span class="stat-bar"><span class="stat-plus">${escapeHtml(row.plus)}</span><span class="stat-minus">${escapeHtml(row.minus)}</span></span>
    </div>`).join('')}</div>${totals.map(line => `<div class="stat-total">${escapeHtml(line)}</div>`).join('')}${raw.map(line => `<div class="stat-raw">${escapeHtml(line)}</div>`).join('')}</section>`;
}

export function commitPatchPreviewHtml(meta: PatchPreviewMeta, patch: string): string {
  const parsed = splitPatch(patch);
  const hash = meta.hash ? `<span class="hash">${escapeHtml(meta.hash)}</span>` : '';
  const subject = meta.subject ? `<div class="subject">${escapeHtml(meta.subject)}</div>` : '';
  const subtitle = [meta.author, meta.relativeDate, meta.subtitle].filter(Boolean).join(' · ');
  const stats = renderStats(parsed.stats);
  const header = !subject && parsed.header.length ? `<section class="raw-header">${parsed.header.map(line => `<div>${escapeHtml(line)}</div>`).join('')}</section>` : '';
  const files = parsed.files.length ? parsed.files.map(file => `
    <section class="file-card">
      <header class="file-title">${escapeHtml(file.title)}</header>
      ${file.meta.length ? `<div class="file-meta">${file.meta.map(escapeHtml).join('<br>')}</div>` : ''}
      <div class="diff-body">${file.lines.map(renderPatchLine).join('')}</div>
    </section>`).join('') : '<section class="empty">No patch content.</section>';

  return `<!doctype html><html><head><meta charset="UTF-8"><style>
    body{box-sizing:border-box;margin:0;padding:18px 22px;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);}
    .hero{display:flex;align-items:flex-start;gap:10px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--vscode-editorWidget-border,var(--vscode-panel-border));}
    .hash{font-family:var(--vscode-editor-font-family);font-size:12px;border-radius:4px;padding:2px 6px;background:var(--vscode-editorInlayHint-background);color:var(--vscode-editorInlayHint-foreground);}
    .subject{font-size:18px;font-weight:650;line-height:1.25;margin-bottom:4px;}
    .subtitle{color:var(--vscode-descriptionForeground);font-size:12px;}
    h2{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--vscode-descriptionForeground);margin:0 0 7px;}
    .stats,.raw-header{margin:0 0 14px;padding:10px 12px;border:1px solid var(--vscode-editorWidget-border,var(--vscode-panel-border));border-radius:8px;background:var(--vscode-sideBar-background);font-family:var(--vscode-editor-font-family);font-size:12px;white-space:pre-wrap;}
    .stats-list{display:flex;flex-direction:column;gap:3px;white-space:normal;}
    .stat-row{display:grid;grid-template-columns:minmax(0,1fr) 42px minmax(70px,22%);align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid color-mix(in srgb,var(--vscode-editorWidget-border,var(--vscode-panel-border)) 55%,transparent);}
    .stat-row:last-child{border-bottom:0;}
    .stat-file{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-foreground);}
    .stat-count{text-align:right;color:var(--vscode-descriptionForeground);font-variant-numeric:tabular-nums;}
    .stat-bar{overflow:hidden;white-space:nowrap;letter-spacing:.03em;}
    .stat-plus{color:var(--vscode-gitDecoration-addedResourceForeground,#2ea043);}
    .stat-minus{color:var(--vscode-gitDecoration-deletedResourceForeground,#f85149);}
    .stat-total,.stat-raw{margin-top:8px;color:var(--vscode-descriptionForeground);font-family:var(--vscode-font-family);font-size:12px;}
    .file-card{margin:0 0 14px;border:1px solid var(--vscode-editorWidget-border,var(--vscode-panel-border));border-radius:8px;overflow:hidden;background:var(--vscode-editor-background);}
    .file-title{padding:8px 11px;font-weight:650;background:var(--vscode-sideBarSectionHeader-background);border-bottom:1px solid var(--vscode-editorWidget-border,var(--vscode-panel-border));}
    .file-meta{padding:7px 11px;color:var(--vscode-descriptionForeground);background:var(--vscode-sideBar-background);font-family:var(--vscode-editor-font-family);font-size:11px;border-bottom:1px solid var(--vscode-editorWidget-border,var(--vscode-panel-border));}
    .diff-body{font-family:var(--vscode-editor-font-family);font-size:12px;line-height:1.45;overflow:auto;}
    .diff-line{display:flex;white-space:pre;min-height:18px;}
    .diff-prefix{width:18px;text-align:center;flex:0 0 18px;opacity:.75;}
    .diff-text{padding-right:12px;}
    .diff-add{background:color-mix(in srgb,var(--vscode-gitDecoration-addedResourceForeground,#2ea043) 16%,transparent);}
    .diff-del{background:color-mix(in srgb,var(--vscode-gitDecoration-deletedResourceForeground,#f85149) 16%,transparent);}
    .diff-hunk{color:var(--vscode-list-highlightForeground);background:var(--vscode-editorInlayHint-background);font-weight:650;}
    .diff-meta{color:var(--vscode-descriptionForeground);}
    .empty{color:var(--vscode-descriptionForeground);padding:14px;}
  </style></head><body>
    <main>
      <section class="hero"><div>${hash}</div><div>${subject || `<div class="subject">${escapeHtml(meta.title)}</div>`}<div class="subtitle">${escapeHtml(subtitle)}</div></div></section>
      ${stats}
      ${header}
      ${files}
    </main>
  </body></html>`;
}
