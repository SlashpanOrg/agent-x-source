import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';

export async function chartGenerate(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string;
  const chartType = args['type'] as string;
  const title = (args['title'] as string) ?? 'Chart';
  const labels = args['labels'] as string[] | undefined;
  const datasets = args['datasets'] as Array<{ label: string; data: number[]; color?: string }> | undefined;
  const width = (args['width'] as number) ?? 800;
  const height = (args['height'] as number) ?? 600;

  if (!file || !chartType || !labels || !datasets) {
    return { success: false, output: 'file, type, labels, and datasets are required', error: 'MISSING_INPUT' };
  }

  // Generate an SVG chart using inline SVG
  const margin = { top: 40, right: 20, bottom: 60, left: 60 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<style>
  .bar { transition: opacity 0.2s; }
  .bar:hover { opacity: 0.7; }
  .axis text { font-size: 11px; fill: #333; }
  .label { font-size: 13px; fill: #555; }
</style>
<rect width="100%" height="100%" fill="white"/>
<text x="${width / 2}" y="25" text-anchor="middle" font-size="16" font-weight="bold" fill="#333">${escapeXml(title)}</text>
`;

  const colors = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'];

  if (chartType === 'bar') {
    const barWidth = Math.max(5, Math.min(40, (chartW - 20) / (labels.length * datasets.length + labels.length - 1) - 5));
    const maxVal = Math.max(...datasets.flatMap(d => d.data), 1);
    const xStep = (chartW - 20) / labels.length;

    svg += `<g transform="translate(${margin.left},${margin.top})">
      <line x1="0" y1="${chartH}" x2="${chartW}" y2="${chartH}" stroke="#ccc"/>
      <line x1="0" y1="0" x2="0" y2="${chartH}" stroke="#ccc"/>`;

    // Y axis labels
    for (let i = 0; i <= 4; i++) {
      const y = chartH - (chartH * i / 4);
      const val = Math.round(maxVal * i / 4);
      svg += `<text x="-8" y="${y + 4}" text-anchor="end" class="axis">${val}</text>`;
      svg += `<line x1="0" y1="${y}" x2="${chartW}" y2="${y}" stroke="#eee" stroke-dasharray="2 2"/>`;
    }

    // Bars
    datasets.forEach((ds, di) => {
      const color = ds.color ?? colors[di % colors.length];
      ds.data.forEach((val, i) => {
        const x = i * xStep + (xStep - barWidth * datasets.length) / 2 + di * barWidth;
        const barH = (val / maxVal) * chartH;
        svg += `<rect x="${x}" y="${chartH - barH}" width="${barWidth}" height="${barH}" fill="${color}" class="bar" rx="2"/>`;
      });
    });

    // X axis labels
    labels.forEach((label, i) => {
      const x = i * xStep + xStep / 2;
      svg += `<text x="${x}" y="${chartH + 18}" text-anchor="middle" class="axis" transform="rotate(-30,${x},${chartH + 18})">${escapeXml(label)}</text>`;
    });

    // Legend
    const legendY = chartH + 40;
    datasets.forEach((ds, i) => {
      const color = ds.color ?? colors[i % colors.length];
      const lx = 10 + i * 120;
      svg += `<rect x="${lx}" y="${legendY}" width="12" height="12" fill="${color}"/>`;
      svg += `<text x="${lx + 16}" y="${legendY + 11}" class="label">${escapeXml(ds.label)}</text>`;
    });
  } else if (chartType === 'line') {
    const maxVal = Math.max(...datasets.flatMap(d => d.data), 1);
    const xStep = chartW / Math.max(labels.length - 1, 1);

    svg += `<g transform="translate(${margin.left},${margin.top})">
      <line x1="0" y1="${chartH}" x2="${chartW}" y2="${chartH}" stroke="#ccc"/>
      <line x1="0" y1="0" x2="0" y2="${chartH}" stroke="#ccc"/>`;

    // Y axis
    for (let i = 0; i <= 4; i++) {
      const y = chartH - (chartH * i / 4);
      const val = Math.round(maxVal * i / 4);
      svg += `<text x="-8" y="${y + 4}" text-anchor="end" class="axis">${val}</text>`;
    }

    // Lines + dots
    datasets.forEach((ds, di) => {
      const color = ds.color ?? colors[di % colors.length];
      const points = ds.data.map((val, i) => `${i * xStep},${chartH - (val / maxVal) * chartH}`);
      svg += `<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`;
      ds.data.forEach((val, i) => {
        const x = i * xStep;
        const y = chartH - (val / maxVal) * chartH;
        svg += `<circle cx="${x}" cy="${y}" r="4" fill="${color}"/>`;
      });
    });

    // X axis labels
    labels.forEach((label, i) => {
      svg += `<text x="${i * xStep}" y="${chartH + 18}" text-anchor="middle" class="axis">${escapeXml(label)}</text>`;
    });

    // Legend
    datasets.forEach((ds, i) => {
      const color = ds.color ?? colors[i % colors.length];
      const lx = 10 + i * 120;
      svg += `<line x1="${lx}" y1="${chartH + 35}" x2="${lx + 16}" y2="${chartH + 35}" stroke="${color}" stroke-width="2"/>`;
      svg += `<text x="${lx + 20}" y="${chartH + 39}" class="label">${escapeXml(ds.label)}</text>`;
    });
  } else if (chartType === 'pie') {
    const cx = width / 2;
    const cy = height / 2 - 30;
    const radius = Math.min(chartW, chartH) / 2 - 10;

    if (datasets.length === 1 && datasets[0]!.data.length > 0) {
      const data = datasets[0]!.data;
      const totalData = data.reduce((a, b) => a + b, 0) || 1;
      let startAngle = -Math.PI / 2;

      data.forEach((val, i) => {
        if (val === 0) return;
        const sliceAngle = (val / totalData) * 2 * Math.PI;
        const endAngle = startAngle + sliceAngle;
        const x1 = cx + radius * Math.cos(startAngle);
        const y1 = cy + radius * Math.sin(startAngle);
        const x2 = cx + radius * Math.cos(endAngle);
        const y2 = cy + radius * Math.sin(endAngle);
        const largeArc = sliceAngle > Math.PI ? 1 : 0;
        const color = colors[i % colors.length];

        svg += `<path d="M${cx},${cy} L${x1},${y1} A${radius},${radius} 0 ${largeArc},1 ${x2},${y2} Z" fill="${color}" stroke="white" stroke-width="2"/>`;

        // Label
        const midAngle = startAngle + sliceAngle / 2;
        const lx = cx + (radius * 0.65) * Math.cos(midAngle);
        const ly = cy + (radius * 0.65) * Math.sin(midAngle);
        svg += `<text x="${lx}" y="${ly}" text-anchor="middle" fill="white" font-size="12" font-weight="bold">${Math.round(val / totalData * 100)}%</text>`;

        startAngle = endAngle;
      });
    }

    // Legend below the chart
    labels.forEach((label, i) => {
      const lx = 20;
      const ly = height - 30 + i * 20;
      svg += `<rect x="${lx}" y="${ly - 10}" width="12" height="12" fill="${colors[i % colors.length]}" rx="2"/>`;
      svg += `<text x="${lx + 18}" y="${ly}" class="label">${escapeXml(label)}</text>`;
    });
  }

  svg += '</svg>';

  const filePath = resolve(context.scopePath, file);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, svg, 'utf-8');

  return { success: true, output: `Chart saved to ${file} (SVG)` };
}

export async function qrGenerate(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string;
  const data = args['data'] as string;
  const size = (args['size'] as number) ?? 256;

  if (!file || !data) {
    return { success: false, output: 'file and data are required', error: 'MISSING_INPUT' };
  }

  // Try using qrcode npm package first, fallback to API
  try {
    execSync('npx --yes qrcode --help 2>/dev/null', { timeout: 5000 });
    const filePath = resolve(context.scopePath, file);
    mkdirSync(dirname(filePath), { recursive: true });
    execSync(`npx qrcode -o "${filePath}" -s ${size} "${data.replace(/"/g, '\\"')}"`, { timeout: 30000 });
    return { success: true, output: `QR code saved to ${file}` };
  } catch {
    // Fallback: use qrserver.com API
    try {
      const encodedData = encodeURIComponent(data);
      const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodedData}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        return { success: false, output: `QR API error: ${response.status}`, error: 'API_ERROR' };
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const filePath = resolve(context.scopePath, file);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, buffer);
      return { success: true, output: `QR code saved to ${file}` };
    } catch (error) {
      return { success: false, output: `QR generation failed: ${(error as Error).message}. Install qrcode: npm install -g qrcode`, error: 'QR_ERROR' };
    }
  }
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
