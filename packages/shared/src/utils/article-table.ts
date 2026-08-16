/** GFM table line helpers for article save, recover, compile, and excerpts. */

const SEP_CELL_RE = /^:?-{2,}:?$/;

export function parseGfmTableCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return [];
  const collapsed = trimmed.replace(/^\|{2,}/, '|');
  const inner = collapsed.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((cell) => cell.trim());
}

export function isGfmTableSeparator(line: string): boolean {
  const cells = parseGfmTableCells(line).filter((cell) => cell.length > 0);
  return cells.length > 0 && cells.every((cell) => SEP_CELL_RE.test(cell));
}

export function isGfmTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  if (isGfmTableSeparator(trimmed)) return true;
  return trimmed.startsWith('|') || /\|.+\|/.test(trimmed);
}

export function formatGfmTableRow(cells: string[]): string {
  return `| ${cells.map((cell) => cell.trim()).join(' | ')} |`;
}

export function formatGfmTableSeparator(cells: string[]): string {
  return formatGfmTableRow(cells.map(normalizeSeparatorCell));
}

function normalizeSeparatorCell(cell: string): string {
  const trimmed = cell.trim();
  const left = trimmed.startsWith(':');
  const right = trimmed.endsWith(':');
  if (left && right) return ':---:';
  if (right) return '---:';
  if (left) return ':---';
  return '---';
}

function isSeparatorCell(cell: string): boolean {
  return SEP_CELL_RE.test(cell.trim());
}

/** Turn a pipe-row title into a human heading (`Test · Range · Result`). */
export function displayArticleTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return '';
  if (!trimmed.includes('|') && !trimmed.includes('·')) return trimmed.slice(0, 200);
  const cells = cellsFromTitle(trimmed);
  if (!cells.length) return trimmed.slice(0, 200);
  return cells.join(' · ').slice(0, 200);
}

export function humanizeArticleExcerpt(excerpt: string): string {
  const trimmed = excerpt.trim();
  if (!trimmed) return '';
  if (!trimmed.includes('|')) return trimmed.slice(0, 280);
  return trimmed
    .split(/\n/)
    .flatMap((line) => {
      if (isGfmTableSeparator(line)) return [];
      if (!line.includes('|')) return [line.trim()];
      return [parseGfmTableCells(line).filter((cell) => cell && !isSeparatorCell(cell)).join(' · ')];
    })
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}

export function deriveArticleExcerpt(content: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const parts: string[] = [];
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !trimmed || isGfmTableSeparator(trimmed)) continue;
    if (isGfmTableRow(trimmed)) {
      const cells = parseGfmTableCells(trimmed).filter((cell) => cell && !isSeparatorCell(cell));
      if (cells.length) parts.push(cells.join(' · '));
    } else {
      parts.push(trimmed.replace(/[#>*_`~[\]]/g, ' ').replace(/\s+/g, ' ').trim());
    }
    if (parts.join(' ').length >= 280) break;
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 280);
}

function cellsFromTitle(title: string): string[] {
  const trimmed = title.trim();
  if (trimmed.includes('|')) {
    return parseGfmTableCells(trimmed).filter((cell) => cell && !isSeparatorCell(cell));
  }
  if (trimmed.includes('·')) {
    return trimmed.split('·').map((cell) => cell.trim()).filter(Boolean);
  }
  return [];
}

function headersFromTitle(title: string | undefined, columnCount: number): string[] | null {
  if (!title?.trim() || columnCount < 1) return null;
  const cells = cellsFromTitle(title);
  if (cells.length === 0) return null;
  const headers = cells.slice();
  while (headers.length < columnCount) headers.push(`Column ${headers.length + 1}`);
  return headers.slice(0, columnCount);
}

function syntheticHeaders(columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`);
}

/**
 * Restore a GFM header row when save stripped it into the article title
 * and left a separator (often with a leftover `|`) as the first body line.
 */
export function recoverArticleTableHeader(content: string, title?: string): string {
  if (!content.trim()) return content;
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let index = 0;
  while (index < lines.length && !lines[index]!.trim()) index += 1;
  if (index >= lines.length) return content;

  const first = lines[index]!;
  if (!isGfmTableSeparator(first)) return content;

  const sepCells = parseGfmTableCells(first).filter((cell) => cell.length > 0);
  if (sepCells.length < 2) return content;

  const headers = headersFromTitle(title, sepCells.length) ?? syntheticHeaders(sepCells.length);
  const next = [
    ...lines.slice(0, index),
    formatGfmTableRow(headers),
    formatGfmTableSeparator(sepCells),
    ...lines.slice(index + 1),
  ];
  return next.join('\n');
}
