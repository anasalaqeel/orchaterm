/**
 * promptTemplate.ts
 *
 * Variable interpolation and context gathering for AI Prompt Quick Actions
 * and Prompt Vault templates.
 */

export interface PromptContext {
  selection?: string;
  terminalOutput?: string;
  workspaceName?: string;
  workspacePath?: string;
  spaceName?: string;
}

export const TEMPLATE_VARIABLES = [
  { variable: '{{selection}}', description: 'Currently selected text in the active terminal' },
  {
    variable: '{{terminal_output}}',
    description: 'Recent output buffer from the active terminal (~2000 chars)',
  },
  { variable: '{{workspace_name}}', description: 'Name of the currently active workspace' },
  { variable: '{{workspace_path}}', description: 'Filesystem path of the active workspace' },
  { variable: '{{space_name}}', description: 'Name of the current space (if selected)' },
  { variable: '{{date}}', description: 'Current date (YYYY-MM-DD)' },
  { variable: '{{time}}', description: 'Current local time (HH:MM:SS)' },
] as const;

/**
 * Interpolates variables within a prompt template string.
 */
export function interpolatePromptTemplate(template: string, context: PromptContext = {}): string {
  if (!template) return '';

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toLocaleTimeString();

  const replacements: Record<string, string> = {
    '{{selection}}': context.selection || '',
    '{{terminal_output}}': context.terminalOutput || '',
    '{{last_output}}': context.terminalOutput || '',
    '{{output}}': context.terminalOutput || '',
    '{{workspace_name}}': context.workspaceName || 'Current Workspace',
    '{{workspace_path}}': context.workspacePath || '',
    '{{space_name}}': context.spaceName || 'Default Space',
    '{{date}}': dateStr,
    '{{time}}': timeStr,
  };

  let result = template;
  for (const [key, val] of Object.entries(replacements)) {
    result = result.split(key).join(val);
  }

  return result;
}

/**
 * Helper to extract recent text from an xterm terminal instance buffer.
 */
export function extractTerminalBuffer(term: any, maxLines: number = 60): string {
  if (!term || !term.buffer || !term.buffer.active) return '';

  try {
    const buffer = term.buffer.active;
    const endRow = buffer.length - 1;
    const startRow = Math.max(0, endRow - maxLines);
    const lines: string[] = [];

    for (let r = startRow; r <= endRow; r++) {
      const line = buffer.getLine(r);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }

    // Trim trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }

    return lines.join('\n');
  } catch (err) {
    console.warn('[promptTemplate] Failed to extract terminal buffer:', err);
    return '';
  }
}
