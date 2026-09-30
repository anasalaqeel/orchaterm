import { describe, it, expect } from 'vitest';
import {
  parseIntentResponse,
  parseCommandResponse,
  buildCommandExtractPrompt,
} from '../services/orchestratorPrompts';

describe('parseIntentResponse', () => {
  it('classifies command before plan (order matters)', () => {
    expect(parseIntentResponse('command')).toBe('command');
    expect(parseIntentResponse('COMMAND')).toBe('command');
  });

  it('classifies plan', () => {
    expect(parseIntentResponse('plan')).toBe('plan');
    expect(parseIntentResponse('  Plan  ')).toBe('plan');
  });

  it('defaults to chat for anything else', () => {
    expect(parseIntentResponse('chat')).toBe('chat');
    expect(parseIntentResponse('')).toBe('chat');
    expect(parseIntentResponse('gibberish')).toBe('chat');
    // "command" contained in a word boundary check — "recommanded" should NOT match
    expect(parseIntentResponse('recommanded')).toBe('chat');
  });
});

describe('parseCommandResponse', () => {
  it('parses a plain JSON object', () => {
    expect(
      parseCommandResponse('{"action": "checkpoint", "source": "claude", "destination": ""}')
    ).toEqual({ action: 'checkpoint', source: 'claude', destination: '' });
  });

  it('parses JSON wrapped in prose or code fences', () => {
    const fenced =
      '```json\n{"action": "pass_work", "source": "claude", "destination": "gemini"}\n```';
    expect(parseCommandResponse(fenced)).toEqual({
      action: 'pass_work',
      source: 'claude',
      destination: 'gemini',
    });
    expect(
      parseCommandResponse('Here you go: {"action": "status", "source": "", "destination": ""}')
    ).toEqual({ action: 'status', source: '', destination: '' });
  });

  it('trims whitespace in fields', () => {
    expect(parseCommandResponse('{"action":"status","source":"  ","destination":" x "}')).toEqual({
      action: 'status',
      source: '',
      destination: 'x',
    });
  });

  it('returns null for unknown actions', () => {
    expect(parseCommandResponse('{"action": "destroy", "source": "x"}')).toBeNull();
  });

  it('returns null for garbage and missing JSON', () => {
    expect(parseCommandResponse('no json here')).toBeNull();
    expect(parseCommandResponse('{action: broken}')).toBeNull();
    expect(parseCommandResponse('{"action": 42}')).toBeNull();
  });

  it('returns null for invalid top-level JSON even when it looks like an object', () => {
    expect(parseCommandResponse('{"action": "status"')).toBeNull();
  });
});

describe('buildCommandExtractPrompt', () => {
  it('lists the session titles for exact copying', () => {
    const { userContent } = buildCommandExtractPrompt('checkpoint claude', ['claude', 'gemini']);
    expect(userContent).toContain('"claude"');
    expect(userContent).toContain('"gemini"');
    expect(userContent).toContain('checkpoint claude');
  });

  it('handles the no-terminals case', () => {
    const { userContent } = buildCommandExtractPrompt('status', []);
    expect(userContent).toContain('(no terminals open)');
  });
});
