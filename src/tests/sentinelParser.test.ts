import { describe, it, expect } from 'vitest';
import { parseNeedsBlock, parseSentinel } from '../services/sentinelParser';

describe('parseNeedsBlock', () => {
  it('returns null when no NEEDS block is present', () => {
    expect(parseNeedsBlock('some terminal output without a block')).toBeNull();
  });

  it('returns null when block is incomplete (start but no end)', () => {
    const buf = 'output\n###ORCHATERM_NEEDS###\nask: something\n';
    expect(parseNeedsBlock(buf)).toBeNull();
  });

  it('parses a complete NEEDS block', () => {
    const buf = [
      'Some agent output',
      '###ORCHATERM_NEEDS###',
      'ask: What is the database schema?',
      'context: I need to write a migration',
      '###ORCHATERM_NEEDS_END###',
    ].join('\n');

    const result = parseNeedsBlock(buf);
    expect(result).not.toBeNull();
    expect(result!.ask).toBe('What is the database schema?');
    expect(result!.context).toBe('I need to write a migration');
  });

  it('uses the LAST complete block in the buffer (handles repeated attempts)', () => {
    const buf = [
      '###ORCHATERM_NEEDS###',
      'ask: First question',
      'context: first context',
      '###ORCHATERM_NEEDS_END###',
      'more output',
      '###ORCHATERM_NEEDS###',
      'ask: Second question',
      'context: second context',
      '###ORCHATERM_NEEDS_END###',
    ].join('\n');

    const result = parseNeedsBlock(buf);
    expect(result!.ask).toBe('Second question');
  });

  it('strips ANSI codes before parsing', () => {
    const buf = [
      '\x1b[32m###ORCHATERM_NEEDS###\x1b[0m',
      'ask: What is X?',
      'context: doing Y',
      '###ORCHATERM_NEEDS_END###',
    ].join('\n');

    expect(parseNeedsBlock(buf)).not.toBeNull();
    expect(parseNeedsBlock(buf)!.ask).toBe('What is X?');
  });

  it('returns empty string for context when field is missing', () => {
    const buf = [
      '###ORCHATERM_NEEDS###',
      'ask: What is X?',
      '###ORCHATERM_NEEDS_END###',
    ].join('\n');

    const result = parseNeedsBlock(buf);
    expect(result!.ask).toBe('What is X?');
    expect(result!.context).toBe('');
  });
});

describe('parseSentinel', () => {
  it('returns null when no sentinel is present', () => {
    expect(parseSentinel('some terminal output')).toBeNull();
  });

  it('parses a clean sentinel block', () => {
    const buf = [
      'Agent did some work',
      '###ORCHATERM_DONE###',
      'task_id: task-1',
      'summary: Built the login page.',
      'files_modified: src/login.tsx',
      'needs: none',
      '###ORCHATERM_END###',
    ].join('\n');
    const result = parseSentinel(buf);
    expect(result).not.toBeNull();
    expect(result!.taskId).toBe('task-1');
    expect(result!.summary).toBe('Built the login page.');
    expect(result!.filesModified).toEqual(['src/login.tsx']);
    expect(result!.needs).toBe('none');
  });

  it('parses sentinel when markers are wrapped in ANSI codes', () => {
    const buf = [
      'Agent output',
      '\x1b[32m###ORCHATERM_DONE###\x1b[0m',
      'task_id: task-2',
      'summary: Fixed the bug.',
      'files_modified: none',
      'needs: none',
      '\x1b[0m###ORCHATERM_END###',
    ].join('\n');
    const result = parseSentinel(buf);
    expect(result).not.toBeNull();
    expect(result!.taskId).toBe('task-2');
    expect(result!.summary).toBe('Fixed the bug.');
  });

  it('parses sentinel when ANSI codes land within marker text', () => {
    // This is the critical bug case: ANSI codes inside the marker break raw indexOf
    const buf = [
      'Agent output',
      '###ORCHATERM_D\x1b[0mONE###',
      'task_id: task-3',
      'summary: Handled the edge case.',
      'files_modified: none',
      'needs: none',
      '###ORCHATERM_END###',
    ].join('\n');
    const result = parseSentinel(buf);
    expect(result).not.toBeNull();
    expect(result!.taskId).toBe('task-3');
    expect(result!.summary).toBe('Handled the edge case.');
  });

  it('rejects sentinel echo (placeholder summary)', () => {
    const buf = [
      '###ORCHATERM_DONE###',
      'task_id: task-1',
      'summary: <2-3 sentences: what you built>',
      'files_modified: none',
      'needs: none',
      '###ORCHATERM_END###',
    ].join('\n');
    expect(parseSentinel(buf)).toBeNull();
  });
});
