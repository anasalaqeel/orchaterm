import { describe, it, expect } from 'vitest';
import { parseDetectionLabel } from '../services/continuationPrompts';

describe('parseDetectionLabel', () => {
  it('parses an exact single-word reply', () => {
    expect(parseDetectionLabel('STOPPED')).toBe('STOPPED');
    expect(parseDetectionLabel('LIMIT_HIT')).toBe('LIMIT_HIT');
  });

  it('parses decorated replies from real models', () => {
    expect(parseDetectionLabel('STOPPED.')).toBe('STOPPED');
    expect(parseDetectionLabel('Label: STOPPED')).toBe('STOPPED');
    expect(parseDetectionLabel('The agent hit a LIMIT_HIT and cannot continue.')).toBe('LIMIT_HIT');
    expect(parseDetectionLabel('  task_complete\n')).toBe('TASK_COMPLETE');
  });

  it('falls back to PROGRESS for unrecognisable replies', () => {
    expect(parseDetectionLabel('')).toBe('PROGRESS');
    expect(parseDetectionLabel('the agent is doing things')).toBe('PROGRESS');
    expect(parseDetectionLabel('PROGRESSING')).toBe('PROGRESS'); // partial word, not a label
  });
});
