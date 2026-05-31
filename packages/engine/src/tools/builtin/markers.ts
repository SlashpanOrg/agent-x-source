const commentSyntax: Record<string, string> = {
  '.ts': '//',
  '.tsx': '//',
  '.js': '//',
  '.jsx': '//',
  '.mjs': '//',
  '.cjs': '//',
  '.mts': '//',
  '.cts': '//',
  '.d.ts': '//',
  '.go': '//',
  '.rs': '//',
  '.c': '//',
  '.h': '//',
  '.cpp': '//',
  '.hpp': '//',
  '.cs': '//',
  '.java': '//',
  '.kt': '//',
  '.kts': '//',
  '.swift': '//',
  '.scala': '//',
  '.dart': '//',
  '.php': '//',
  '.rb': '#',
  '.py': '#',
  '.sh': '#',
  '.bash': '#',
  '.zsh': '#',
  '.fish': '#',
  '.pl': '#',
  '.pm': '#',
  '.r': '#',
  '.yaml': '#',
  '.yml': '#',
  '.toml': '#',
  '.cfg': '#',
  '.ini': '#',
  '.env': '#',
  '.dockerfile': '#',
  '.gitignore': '#',
  '.npmrc': '#',
  '.editorconfig': '#',
  '.hs': '--',
  '.lua': '--',
  '.sql': '--',
  '.html': '<!--',
  '.xml': '<!--',
  '.svg': '<!--',
  '.vue': '<!--',
  '.svelte': '<!--',
  '.elm': '--',
};

const htmlClose = '-->';
const defaultComment = '//';

export function getAICommentMarker(ext: string, description?: string): string {
  const comment = commentSyntax[ext] ?? defaultComment;
  const suffix = comment === '<!--' ? ` ${htmlClose}` : '';
  const desc = description ? `: ${description}` : '';
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  return `${comment} AI${desc} — ${timestamp}${suffix}`;
}
