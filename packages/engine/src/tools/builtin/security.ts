import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function deriveKey(passphrase: string): Buffer {
  return createHash('sha256').update(passphrase).digest();
}

export async function encryptFile(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string;
  const passphrase = args['passphrase'] as string;

  if (!file || !passphrase) {
    return { success: false, output: 'file and passphrase are required', error: 'MISSING_INPUT' };
  }

  const filePath = resolve(context.scopePath, file);
  if (!existsSync(filePath)) {
    return { success: false, output: 'File not found', error: 'NOT_FOUND' };
  }

  try {
    const data = readFileSync(filePath);
    const key = deriveKey(passphrase);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Output: iv + authTag + encrypted
    const outputPath = filePath + '.enc';
    writeFileSync(outputPath, Buffer.concat([iv, authTag, encrypted]));

    return { success: true, output: `Encrypted: ${outputPath}` };
  } catch (error) {
    return { success: false, output: `Encryption failed: ${(error as Error).message}`, error: 'ENCRYPT_ERROR' };
  }
}

export async function decryptFile(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string;
  const passphrase = args['passphrase'] as string;

  if (!file || !passphrase) {
    return { success: false, output: 'file and passphrase are required', error: 'MISSING_INPUT' };
  }

  const filePath = resolve(context.scopePath, file);
  if (!existsSync(filePath)) {
    return { success: false, output: 'File not found', error: 'NOT_FOUND' };
  }

  try {
    const data = readFileSync(filePath);
    const key = deriveKey(passphrase);

    // Parse: iv (16) + authTag (16) + encrypted
    const iv = data.subarray(0, IV_LENGTH) as Buffer;
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + 16) as Buffer;
    const encrypted = data.subarray(IV_LENGTH + 16) as Buffer;

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    const outputPath = filePath.replace(/\.enc$/, '') + '.decrypted';
    writeFileSync(outputPath, decrypted);

    return { success: true, output: `Decrypted: ${outputPath}` };
  } catch (error) {
    return { success: false, output: `Decryption failed (wrong passphrase or corrupt file): ${(error as Error).message}`, error: 'DECRYPT_ERROR' };
  }
}

export async function jwtDecode(args: Record<string, unknown>): Promise<ToolResult> {
  const token = args['token'] as string;

  if (!token) {
    return { success: false, output: 'token is required', error: 'MISSING_INPUT' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { success: false, output: 'Invalid JWT format (expected 3 parts)', error: 'INVALID_FORMAT' };
  }

  try {
    const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf-8'));
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf-8'));

    const output = [
      '=== Header ===',
      JSON.stringify(header, null, 2),
      '',
      '=== Payload ===',
      JSON.stringify(payload, null, 2),
      '',
      '=== Meta ===',
      `Signature: ${parts[2]!.slice(0, 20)}... (${parts[2]!.length} chars)`,
      '(Signature not verified)',
    ].join('\n');

    return { success: true, output };
  } catch (error) {
    return { success: false, output: `JWT decode failed: ${(error as Error).message}`, error: 'DECODE_ERROR' };
  }
}

export async function secretGenerate(args: Record<string, unknown>): Promise<ToolResult> {
  const length = (args['length'] as number) ?? 32;
  const encoding = (args['encoding'] as string) ?? 'hex';

  if (length < 1 || length > 1024) {
    return { success: false, output: 'length must be between 1 and 1024', error: 'INVALID_ARGS' };
  }

  const validEncodings = ['hex', 'base64', 'base64url'];
  if (!validEncodings.includes(encoding)) {
    return { success: false, output: `encoding must be one of: ${validEncodings.join(', ')}`, error: 'INVALID_ARGS' };
  }

  const bytes = randomBytes(Math.ceil(length * (encoding === 'hex' ? 0.5 : 0.75)));
  const secret = bytes.toString(encoding as BufferEncoding).slice(0, length);

  return { success: true, output: secret, metadata: { length: secret.length, encoding } };
}
