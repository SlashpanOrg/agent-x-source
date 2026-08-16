/**
 * Article-local source prep. Does not use CrewAwareMarkdown or chat
 * section splitting — only restore stolen table headers, repair GFM tables,
 * and flatten HTML color tags into tokens.
 */

import {
  formatGfmTableSeparator,
  isGfmTableRow,
  isGfmTableSeparator,
  parseGfmTableCells,
  recoverArticleTableHeader,
  repairStreamTextGlitches,
} from '@agentx/shared/browser';
import { prepareAssistantMarkup } from '../chat/assistant-markup';

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|');
}

function expandCollapsedTableLine(line: string): string[] {
  const trimmed = line.trim();
  if (!isTableRow(trimmed) || !/\|\s+\|/.test(trimmed)) return [line];
  const segments = trimmed.split(/\|\s+\|/).map((seg, idx, arr) => {
    if (idx === 0) return seg.startsWith('|') ? `${seg} |` : `| ${seg} |`;
    if (idx === arr.length - 1) return seg.endsWith('|') ? `| ${seg}` : `| ${seg} |`;
    return `| ${seg} |`;
  });
  return segments.length < 2 ? [line] : segments;
}

/** Fix GFM tables: missing separators, collapsed rows, blank gaps before totals. */
export function repairArticleTables(content: string): string {
  if (!content || !content.includes('|')) return content;

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inTable = false;
  let tableHasSeparator = false;

  for (let i = 0; i < lines.length; i++) {
    const expanded = expandCollapsedTableLine(lines[i]!);
    if (expanded.length > 1) {
      inTable = false;
      tableHasSeparator = false;
      for (const row of expanded) out.push(row);
      continue;
    }

    const line = lines[i]!;

    if (inTable && tableHasSeparator && line.trim() === '') {
      let j = i + 1;
      while (j < lines.length && lines[j]!.trim() === '') j++;
      const cont = j < lines.length ? lines[j]! : '';
      const after = j + 1 < lines.length ? lines[j + 1]! : '';
      if (cont && isTableRow(cont) && !isGfmTableSeparator(cont) && !isGfmTableSeparator(after)) {
        i = j - 1;
        continue;
      }
      inTable = false;
      tableHasSeparator = false;
      out.push(line);
      continue;
    }

    if (!isGfmTableRow(line) && !isTableRow(line)) {
      inTable = false;
      tableHasSeparator = false;
      out.push(line);
      continue;
    }

    if (isGfmTableSeparator(line)) {
      if (!inTable) {
        out.push(line);
        continue;
      }
      if (tableHasSeparator) continue;
      out.push(line);
      tableHasSeparator = true;
      continue;
    }

    if (!inTable) {
      const headerCols = parseGfmTableCells(line).length;
      if (headerCols < 2) {
        out.push(line);
        continue;
      }
      inTable = true;
      tableHasSeparator = false;
      out.push(line);
      const next = lines[i + 1]?.trim() ?? '';
      if (isGfmTableSeparator(next)) {
        const sepCols = parseGfmTableCells(next).filter(Boolean).length;
        out.push(sepCols === headerCols ? lines[i + 1]! : formatGfmTableSeparator(Array.from({ length: headerCols }, () => '---')));
        tableHasSeparator = true;
        i++;
      } else if (next && isTableRow(next)) {
        out.push(formatGfmTableSeparator(Array.from({ length: headerCols }, () => '---')));
        tableHasSeparator = true;
      } else if (!next) {
        out.push(formatGfmTableSeparator(Array.from({ length: headerCols }, () => '---')));
        tableHasSeparator = true;
      }
      continue;
    }

    out.push(line);
  }

  return out.join('\n');
}

export function prepareArticleSource(content: string, title?: string): string {
  return prepareAssistantMarkup(
    repairArticleTables(recoverArticleTableHeader(repairStreamTextGlitches(content), title)),
  );
}
