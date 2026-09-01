import { describe, it, expect } from 'vitest';
import { buildBlackboardMd, blackboardPath } from '../services/blackboard';
import type { OrchestratorPlan, OrchestratorTask } from '../types';

function task(overrides: Partial<OrchestratorTask> = {}): OrchestratorTask {
  return {
    id: 't1',
    title: 'Write login form',
    description: 'Build the login form',
    assignedSessionId: 's1',
    assignedSessionTitle: 'agent-1',
    dependsOn: [],
    status: 'pending',
    ...overrides,
  };
}

function plan(overrides: Partial<OrchestratorPlan> = {}): OrchestratorPlan {
  return {
    id: 'p1',
    goal: 'Ship the auth flow',
    tasks: [task()],
    status: 'running',
    createdAt: Date.now(),
    workspaceId: 'w1',
    spaceId: null,
    ...overrides,
  };
}

describe('buildBlackboardMd', () => {
  it('includes the goal and every task with status and agent', () => {
    const md = buildBlackboardMd(
      plan({
        tasks: [
          task({ status: 'done' }),
          task({ id: 't2', title: 'Write tests', status: 'running' }),
        ],
      })
    );
    expect(md).toContain('Ship the auth flow');
    expect(md).toContain('✅ Done — Write login form');
    expect(md).toContain('▶ Running — Write tests');
    expect(md).toContain('Agent: agent-1');
    expect(md).toContain('do not edit manually');
  });

  it('includes completed task output: summary, files, and handoff needs', () => {
    const md = buildBlackboardMd(
      plan({
        tasks: [
          task({
            status: 'done',
            output: {
              raw: '...',
              taskId: 't1',
              summary: 'Built the form in src/Login.tsx.',
              filesModified: ['src/Login.tsx'],
              needs: 'Import the new schema from task 2',
            },
          }),
        ],
      })
    );
    expect(md).toContain('Built the form in src/Login.tsx.');
    expect(md).toContain('src/Login.tsx');
    expect(md).toContain('Import the new schema from task 2');
  });

  it('omits the handoff line when needs is "none"', () => {
    const md = buildBlackboardMd(
      plan({
        tasks: [
          task({
            status: 'done',
            output: { raw: '', taskId: 't1', summary: 'Done.', filesModified: [], needs: 'none' },
          }),
        ],
      })
    );
    expect(md).not.toContain('Handoff');
  });

  it('lists dependencies of dependent tasks', () => {
    const md = buildBlackboardMd(
      plan({ tasks: [task(), task({ id: 't2', title: 'Write tests', dependsOn: ['t1'] })] })
    );
    expect(md).toContain('Depends on: t1');
  });

  it('shows the verification outcome on completed tasks', () => {
    const withVerify = plan({
      tasks: [
        task({
          status: 'done',
          output: {
            raw: '',
            taskId: 't1',
            summary: 'Done.',
            filesModified: [],
            needs: 'none',
            verification: { passed: true, command: 'npm test', output: 'ok' },
          },
        }),
        task({
          id: 't2',
          title: 'Write docs',
          status: 'done',
          output: {
            raw: '',
            taskId: 't2',
            summary: 'Done.',
            filesModified: [],
            needs: 'none',
            verification: { passed: false, command: 'npm test', output: 'fail' },
          },
        }),
      ],
    });
    const md = buildBlackboardMd(withVerify);
    expect(md).toContain('Verification: PASSED (npm test)');
    expect(md).toContain('Verification: FAILED (npm test)');
    expect(md).toContain('treat this task');
  });
});

describe('blackboardPath', () => {
  it('places the board inside the .orchaterm directory, normalising separators', () => {
    expect(blackboardPath('C:\\repos\\app')).toBe('C:/repos/app/.orchaterm/ORCHATERM_BOARD.md');
    expect(blackboardPath('C:\\repos\\app\\')).toBe('C:/repos/app/.orchaterm/ORCHATERM_BOARD.md');
    expect(blackboardPath('/home/u/app')).toBe('/home/u/app/.orchaterm/ORCHATERM_BOARD.md');
  });
});
