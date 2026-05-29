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
}

export async function generateCheckpoint(
  input: CheckpointInput,
  llmProvider: LLMProvider,
): Promise<CheckpointSnapshot> {
  const cleanBuffer = stripAnsiCodes(input.rawBuffer);

  let narrative = '';
  let partial = false;
  try {
    const { system, userContent } = buildCheckpointNarrativePrompt(
      cleanBuffer,
      input.sessionTitle,
      input.goalHint,
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
