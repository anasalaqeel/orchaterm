import { describe, it, expect } from 'vitest';
import {
  buildCompletionJudgePrompt,
  parseCompletionJudgeResponse,
} from '../services/orchestratorPrompts';

describe('parseCompletionJudgeResponse', () => {
  it('parses DONE with a summary line', () => {
    const verdict = parseCompletionJudgeResponse('DONE\nCreated the login form in src/Login.tsx.');
    expect(verdict.complete).toBe(true);
    expect(verdict.summary).toBe('Created the login form in src/Login.tsx.');
  });

  it('parses WAITING as not complete', () => {
    expect(parseCompletionJudgeResponse('WAITING').complete).toBe(false);
    expect(parseCompletionJudgeResponse('WAITING\nthe agent is still streaming').complete).toBe(
      false
    );
  });

  it('uses a default summary when DONE has no second line', () => {
    const verdict = parseCompletionJudgeResponse('DONE');
    expect(verdict.complete).toBe(true);
    expect(verdict.summary.length).toBeGreaterThan(0);
  });

  it('treats malformed replies as not complete (fail-safe)', () => {
    // A garbage reply must never complete a task on its own.
    expect(parseCompletionJudgeResponse('').complete).toBe(false);
    expect(parseCompletionJudgeResponse('I think it finished').complete).toBe(false);
    expect(parseCompletionJudgeResponse('done?').complete).toBe(false);
  });

  it('joins multi-line summaries into one string', () => {
    const verdict = parseCompletionJudgeResponse('DONE\nRan the test suite.\nAll 42 tests passed.');
    expect(verdict.complete).toBe(true);
    expect(verdict.summary).toBe('Ran the test suite. All 42 tests passed.');
  });
});

describe('buildCompletionJudgePrompt', () => {
  it('includes the task instructions and terminal output', () => {
    const { system, userContent } = buildCompletionJudgePrompt(
      'Run tests',
      'Run npm test and report results',
      '$ npm test\nall passing'
    );
    expect(system).toContain('DONE or WAITING');
    expect(userContent).toContain('Run tests');
    expect(userContent).toContain('npm test and report results');
    expect(userContent).toContain('all passing');
  });
});
