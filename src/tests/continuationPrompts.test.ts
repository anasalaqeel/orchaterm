import { describe, it, expect } from 'vitest';
import {
  buildDetectionPrompt,
  buildCheckpointNarrativePrompt,
} from '../services/continuationPrompts';

describe('buildDetectionPrompt', () => {
  it('returns system and userContent strings', () => {
    const { system, userContent } = buildDetectionPrompt(
      'Claude Code: usage limit reached',
      'Claude'
    );
    expect(typeof system).toBe('string');
    expect(typeof userContent).toBe('string');
    expect(system.length).toBeGreaterThan(20);
    expect(userContent).toContain('Claude Code: usage limit reached');
  });

  it('includes session title in user content', () => {
    const { userContent } = buildDetectionPrompt('some output', 'Aider');
    expect(userContent).toContain('Aider');
  });
});

describe('buildCheckpointNarrativePrompt', () => {
  it('returns system and userContent strings', () => {
    const { system, userContent } = buildCheckpointNarrativePrompt(
      'terminal output here',
      'Claude',
      'Build an auth system'
    );
    expect(typeof system).toBe('string');
    expect(typeof userContent).toBe('string');
    expect(userContent).toContain('terminal output here');
  });

  it('includes goal hint when provided', () => {
    const { userContent } = buildCheckpointNarrativePrompt(
      'output',
      'Claude',
      'Build auth'
    );
    expect(userContent).toContain('Build auth');
  });

  it('works without goal hint', () => {
    const { system, userContent } = buildCheckpointNarrativePrompt('output', 'Claude');
    expect(typeof system).toBe('string');
    expect(typeof userContent).toBe('string');
  });
});
