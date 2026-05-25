// ── Autonomous orchestration types ────────────────────────────────────────────

/** Controls when automated messages may be injected into a terminal session. */
export type InterruptPolicy =
  | 'never'        // Never auto-inject (safe for all agents, default)
  | 'prompt-only'  // Only inject when the buffer ends with a recognizable shell/agent prompt
  | 'always';      // Inject at any time (for agents known to handle interruptions)

/** Emitted by NeedsBroker when an agent requests help. */
export interface AgentNeedsRequest {
  /** The question the agent is asking. */
  ask: string;
  /** The context the agent provided about its current situation. */
  context: string;
}

/** Events emitted by AutonomousOrchestrator into the GroupChat feed. */
export type RoutingEvent =
  | { type: 'relayed'; from: string; to: string; message: string }
  | { type: 'relay-skipped'; reason: 'interrupt-policy' | 'no-relevant-content'; target: string }
  | { type: 'needs-answered'; requestingAgent: string; question: string; answer: string }
  | { type: 'needs-failed'; requestingAgent: string; error: string };
