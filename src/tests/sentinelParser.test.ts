import { describe, it, expect } from 'vitest';
import { parseNeedsBlock } from '../services/sentinelParser';

describe('parseNeedsBlock', () => {
  it('returns null when no NEEDS block is present', () => {
    expect(parseNeedsBlock('some terminal output without a block')).toBeNull();
  });

  it('returns null when block is incomplete (start but no end)', () => {
    const buf = 'output\n###AGENTDECK_NEEDS###\nask: something\n';
    expect(parseNeedsBlock(buf)).toBeNull();
  });

  it('parses a complete NEEDS block', () => {
    const buf = [
      'Some agent output',
      '###AGENTDECK_NEEDS###',
      'ask: What is the database schema?',
      'context: I need to write a migration',
      '###AGENTDECK_NEEDS_END###',
    ].join('\n');

    const result = parseNeedsBlock(buf);
    expect(result).not.toBeNull();
    expect(result!.ask).toBe('What is the database schema?');
    expect(result!.context).toBe('I need to write a migration');
  });

  it('uses the LAST complete block in the buffer (handles repeated attempts)', () => {
    const buf = [
      '###AGENTDECK_NEEDS###',
      'ask: First question',
      'context: first context',
      '###AGENTDECK_NEEDS_END###',
      'more output',
      '###AGENTDECK_NEEDS###',
      'ask: Second question',
      'context: second context',
      '###AGENTDECK_NEEDS_END###',
    ].join('\n');

    const result = parseNeedsBlock(buf);
    expect(result!.ask).toBe('Second question');
  });

  it('strips ANSI codes before parsing', () => {
    const buf = [
      '\x1b[32m###AGENTDECK_NEEDS###\x1b[0m',
      'ask: What is X?',
      'context: doing Y',
      '###AGENTDECK_NEEDS_END###',
    ].join('\n');

    expect(parseNeedsBlock(buf)).not.toBeNull();
    expect(parseNeedsBlock(buf)!.ask).toBe('What is X?');
  });

  it('returns empty string for context when field is missing', () => {
    const buf = [
      '###AGENTDECK_NEEDS###',
      'ask: What is X?',
      '###AGENTDECK_NEEDS_END###',
    ].join('\n');

    const result = parseNeedsBlock(buf);
    expect(result!.ask).toBe('What is X?');
    expect(result!.context).toBe('');
  });
});
