import * as vscode from 'vscode';
import * as fs from 'fs';
import type { CommandDeps } from '../registerAllCommands';
import { getSecretSauceDir } from '@agentx/engine';

export function openSecretSauceHandler(_deps: CommandDeps): () => Promise<void> {
  return async () => {
    const secretSauceDir = getSecretSauceDir();

    if (!fs.existsSync(secretSauceDir)) {
      fs.mkdirSync(secretSauceDir, { recursive: true });
    }

    const uri = vscode.Uri.file(secretSauceDir);
    await vscode.commands.executeCommand('revealInExplorer', uri);
  };
}
