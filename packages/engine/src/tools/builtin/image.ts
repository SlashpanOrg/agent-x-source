import { existsSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { execSync } from 'node:child_process';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';

export async function imageView(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const filePath = resolve(context.scopePath, args['file'] as string);

  if (!existsSync(filePath)) {
    return { success: false, output: 'Image file not found', error: 'NOT_FOUND' };
  }

  const ext = extname(filePath).toLowerCase();
  const supported = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'];
  if (!supported.includes(ext)) {
    return { success: false, output: `Unsupported format: ${ext}. Supported: ${supported.join(', ')}`, error: 'UNSUPPORTED' };
  }

  const stat = statSync(filePath);
  const info: string[] = [
    `File: ${filePath}`,
    `Format: ${ext.slice(1).toUpperCase()}`,
    `Size: ${(stat.size / 1024).toFixed(1)} KB`,
  ];

  // Try to get dimensions via sips (macOS) or identify (ImageMagick)
  try {
    const dims = execSync(`sips -g pixelWidth -g pixelHeight "${filePath}" 2>/dev/null | grep pixel`, { encoding: 'utf-8' });
    const width = dims.match(/pixelWidth:\s*(\d+)/)?.[1];
    const height = dims.match(/pixelHeight:\s*(\d+)/)?.[1];
    if (width && height) info.push(`Dimensions: ${width}x${height}`);
  } catch {
    try {
      const dims = execSync(`identify -format "%wx%h" "${filePath}" 2>/dev/null`, { encoding: 'utf-8' });
      if (dims.trim()) info.push(`Dimensions: ${dims.trim()}`);
    } catch { /* no image tools available */ }
  }

  return { success: true, output: info.join('\n') };
}

export async function imageResize(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const filePath = resolve(context.scopePath, args['file'] as string);
  const width = args['width'] as number;
  const height = args['height'] as number | undefined;
  const output = args['output'] as string | undefined;
  const outputPath = output ? resolve(context.scopePath, output) : filePath;

  if (!existsSync(filePath)) {
    return { success: false, output: 'Image file not found', error: 'NOT_FOUND' };
  }

  // Try sips (macOS built-in) first, then ImageMagick
  try {
    const dims = height ? `--resampleWidth ${width} --resampleHeight ${height}` : `--resampleWidth ${width}`;
    if (outputPath !== filePath) {
      execSync(`cp "${filePath}" "${outputPath}"`, { encoding: 'utf-8' });
    }
    execSync(`sips ${dims} "${outputPath}" 2>/dev/null`, { encoding: 'utf-8' });
    return { success: true, output: `Resized to ${width}${height ? `x${height}` : 'w'} → ${outputPath}` };
  } catch {
    try {
      const geometry = height ? `${width}x${height}` : `${width}`;
      execSync(`convert "${filePath}" -resize ${geometry} "${outputPath}"`, { encoding: 'utf-8' });
      return { success: true, output: `Resized to ${geometry} → ${outputPath}` };
    } catch (err) {
      return { success: false, output: `No image tool available (sips/ImageMagick): ${(err as Error).message}`, error: 'TOOL_MISSING' };
    }
  }
}

export async function imageConvert(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const filePath = resolve(context.scopePath, args['file'] as string);
  const format = (args['format'] as string).toLowerCase();
  const outputFile = args['output'] as string | undefined;

  if (!existsSync(filePath)) {
    return { success: false, output: 'Image file not found', error: 'NOT_FOUND' };
  }

  const supported = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff'];
  if (!supported.includes(format)) {
    return { success: false, output: `Unsupported target format: ${format}`, error: 'UNSUPPORTED' };
  }

  const defaultOutput = filePath.replace(/\.[^.]+$/, `.${format}`);
  const outPath = outputFile ? resolve(context.scopePath, outputFile) : defaultOutput;

  try {
    // Try sips for macOS
    execSync(`sips -s format ${format === 'jpg' ? 'jpeg' : format} "${filePath}" --out "${outPath}" 2>/dev/null`, { encoding: 'utf-8' });
    return { success: true, output: `Converted → ${outPath}` };
  } catch {
    try {
      execSync(`convert "${filePath}" "${outPath}"`, { encoding: 'utf-8' });
      return { success: true, output: `Converted → ${outPath}` };
    } catch (err) {
      return { success: false, output: `No image tool available: ${(err as Error).message}`, error: 'TOOL_MISSING' };
    }
  }
}
