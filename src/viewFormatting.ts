import * as fs from 'fs';

export function statusIcon(file: { xy: string }): string { return file.xy; }
export function statusClass(file: { xy: string; untracked: boolean; staged: boolean }): string {
  if (file.untracked) return 'untracked';
  if (file.staged && file.xy[1] !== ' ') return 'mixed';
  return file.staged ? 'staged' : 'unstaged';
}
export function repoChangeDescription(repo: { changeCount: number }): string { return repo.changeCount ? `${repo.changeCount} change${repo.changeCount === 1 ? '' : 's'}` : 'clean'; }
export function repoDescription(repo: { changeCount: number }, isCurrent: boolean): string { return [repoChangeDescription(repo), isCurrent ? 'current' : ''].filter(Boolean).join(' · '); }
export function statusRepositoryLabel(repo: { name: string; branch: string; operation?: { label: string } }): string { return `${repo.operation ? `(${repo.operation.label}) ` : ''}${repo.name} → ${repo.branch}`; }
export function recordDogfoodBoundary(event: string, details: Record<string, unknown> = {}) {
  const report = process.env.LGVS_DOGFOOD_BOUNDARY_REPORT;
  if (report) fs.appendFileSync(report, `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`);
}
