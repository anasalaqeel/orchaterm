import { describe, it, expect } from 'vitest';
import { interpolatePromptTemplate, extractTerminalBuffer, PromptContext } from '../utils/promptTemplate';

describe('interpolatePromptTemplate', () => {
  it('returns empty string if template is empty', () => {
    expect(interpolatePromptTemplate('')).toBe('');
  });

  it('interpolates selection and terminal_output correctly', () => {
    const template = 'Error:\n```\n{{terminal_output}}\n```\nSelection: {{selection}}';
    const context: PromptContext = {
      selection: 'const x = 1;',
      terminalOutput: 'ReferenceError: x is not defined',
    };

    const result = interpolatePromptTemplate(template, context);
    expect(result).toContain('ReferenceError: x is not defined');
    expect(result).toContain('const x = 1;');
  });

  it('supports alternative alias tags like {{last_output}} and {{output}}', () => {
    const template1 = 'Logs: {{last_output}}';
    const template2 = 'Logs: {{output}}';
    const context: PromptContext = { terminalOutput: 'Build success' };

    expect(interpolatePromptTemplate(template1, context)).toBe('Logs: Build success');
    expect(interpolatePromptTemplate(template2, context)).toBe('Logs: Build success');
  });

  it('interpolates workspace and space context metadata', () => {
    const template = 'Project: {{workspace_name}} at {{workspace_path}} (Space: {{space_name}})';
    const context: PromptContext = {
      workspaceName: 'orchaterm',
      workspacePath: 'C:/Users/Anas/Desktop/orchaterm',
      spaceName: 'Frontend',
    };

    const result = interpolatePromptTemplate(template, context);
    expect(result).toBe('Project: orchaterm at C:/Users/Anas/Desktop/orchaterm (Space: Frontend)');
  });

  it('replaces unprovided variables with fallback empty strings', () => {
    const template = 'Text: [{{selection}}] Output: [{{terminal_output}}]';
    const result = interpolatePromptTemplate(template, {});
    expect(result).toBe('Text: [] Output: []');
  });
});

describe('extractTerminalBuffer', () => {
  it('returns empty string for null terminal instance', () => {
    expect(extractTerminalBuffer(null)).toBe('');
    expect(extractTerminalBuffer({})).toBe('');
  });

  it('extracts lines from active buffer mockup', () => {
    const mockTerm = {
      buffer: {
        active: {
          length: 3,
          getLine: (r: number) => ({
            translateToString: () => `line ${r + 1}`,
          }),
        },
      },
    };

    const result = extractTerminalBuffer(mockTerm);
    expect(result).toBe('line 1\nline 2\nline 3');
  });
});
