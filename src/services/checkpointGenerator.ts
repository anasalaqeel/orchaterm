import { invoke } from '@tauri-apps/api/core';
import { stripAnsiCodes } from './sentinelParser';
import { buildCheckpointNarrativePrompt } from './continuationPrompts';
import type { LLMProvider } from './llm';
import type { CheckpointSnapshot, DetectionLabel } from '../types';

const RAW_TAIL_CHARS = 3000;

export interface CheckpointInput {
  sessionId: string;
  sessionTitle: string;
  rawBuffer: string;
  workspacePath: string;
  triggeredBy: CheckpointSnapshot['triggeredBy'];
  label: DetectionLabel;
  goalHint?: string;
  maxContextChars?: number;
}

export async function generateCheckpoint(
  input: CheckpointInput,
  llmProvider: LLMProvider,
): Promise<CheckpointSnapshot> {
  const cleanBuffer = stripAnsiCodes(input.rawBuffer);

  let narrative = '';
  let partial = false;
  try {
    const LLM_MAX_CHARS = input.maxContextChars ?? 20000;
    const llmBuffer = cleanBuffer.length > LLM_MAX_CHARS
      ? `... (truncated older output) ...\n${cleanBuffer.slice(-LLM_MAX_CHARS)}`
      : cleanBuffer;

    const dir = `${input.workspacePath}/.orchaterm/checkpoints`;
    const safeTitle = input.sessionTitle.replace(/[^a-zA-Z0-9-_]/g, '_');
    const previousSummary = await getPreviousCheckpointSummary(dir, safeTitle).catch(() => null);

    const { system, userContent } = buildCheckpointNarrativePrompt(
      llmBuffer,
      input.sessionTitle,
      input.goalHint,
      previousSummary || undefined,
    );
    narrative = await llmProvider.complete([{ role: 'user', content: userContent }], system);
  } catch {
    partial = true;
    narrative = '(LLM unavailable — narrative could not be generated)';
  }

  const rawTail = cleanBuffer.slice(-RAW_TAIL_CHARS);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const safeTitle = input.sessionTitle.replace(/[^a-zA-Z0-9-_]/g, '_');
  const fileName = `${safeTitle}-${ts}.md`;
  const dir = `${input.workspacePath}/.orchaterm/checkpoints`;
  const filePath = `${dir}/${fileName}`;

  const content = buildCheckpointMarkdown({
    sessionTitle: input.sessionTitle,
    label: input.label,
    narrative,
    rawTail,
    partial,
  });

  await invoke('write_file_path', { path: filePath, content });

  // Cleanup old checkpoints for this session (keep only the 5 most recent files)
  void cleanupOldCheckpoints(dir, safeTitle, 5);

  return {
    id: crypto.randomUUID(),
    sessionId: input.sessionId,
    sessionTitle: input.sessionTitle,
    filePath,
    triggeredBy: input.triggeredBy,
    label: input.label,
    createdAt: Date.now(),
  };
}

async function cleanupOldCheckpoints(dirPath: string, safeTitle: string, maxFiles: number): Promise<void> {
  const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
  if (!isTauri) return;
  try {
    const { readDir, remove } = await import('@tauri-apps/plugin-fs');
    const entries = await readDir(dirPath);
    const files = entries
      .filter(entry => entry.isFile && entry.name.startsWith(`${safeTitle}-`) && entry.name.endsWith('.md'))
      .map(entry => ({
        name: entry.name,
        path: `${dirPath}/${entry.name}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (files.length > maxFiles) {
      const filesToDelete = files.slice(0, files.length - maxFiles);
      for (const file of filesToDelete) {
        await remove(file.path);
      }
    }
  } catch (e) {
    console.error('Failed to cleanup old checkpoints:', e);
  }
}

async function getPreviousCheckpointSummary(dirPath: string, safeTitle: string): Promise<string | null> {
  const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
  if (!isTauri) return null;
  try {
    const { readDir, readTextFile } = await import('@tauri-apps/plugin-fs');
    const entries = await readDir(dirPath);
    const files = entries
      .filter(entry => entry.isFile && entry.name.startsWith(`${safeTitle}-`) && entry.name.endsWith('.md'))
      .map(entry => ({
        name: entry.name,
        path: `${dirPath}/${entry.name}`,
      }))
      .sort((a, b) => b.name.localeCompare(a.name)); // Sort descending (most recent first)

    if (files.length > 0) {
      const content = await readTextFile(files[0].path);
      // Extract the narrative (everything before the raw tail separator)
      const separatorIdx = content.indexOf('--- \n_Raw output tail') !== -1
        ? content.indexOf('--- \n_Raw output tail')
        : content.indexOf('---');
      if (separatorIdx !== -1) {
        return content.slice(0, separatorIdx).trim();
      }
      return content.trim();
    }
  } catch (e) {
    console.debug('Failed to read previous checkpoint summary:', e);
  }
  return null;
}

function buildCheckpointMarkdown(opts: {
  sessionTitle: string;
  label: DetectionLabel;
  narrative: string;
  rawTail: string;
  partial: boolean;
}): string {
  return `# Checkpoint: ${opts.sessionTitle}
**Generated:** ${new Date().toISOString()}
**Status:** ${opts.label}${opts.partial ? ' _(partial — LLM unavailable)_' : ''}

${opts.narrative}

---
_Raw output tail (last ${RAW_TAIL_CHARS} chars):_

\`\`\`
${opts.rawTail}
\`\`\`
`;
}
