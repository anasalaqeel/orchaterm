// ── Chat panel types ──────────────────────────────────────────────────────────

export type ChatMessageSender =
  | { type: 'user' }
  | { type: 'ollama' }
  | { type: 'agent-summary'; sessionId: string; tabTitle: string; tabColor: string | null }
  | { type: 'conductor'; event: 'dispatch' | 'complete' | 'failed' | 'relay' };

export interface ChatMessage {
  id: string;
  spaceId: string;
  sender: ChatMessageSender;
  content: string;
  timestamp: number;
  /** For agent-summary messages: the raw terminal chunk that was summarised. */
  rawChunk?: string;
  /** For prompt-improvement responses: the improved prompt text. */
  improvedPrompt?: string;
  /** For inject actions: the sessionId that was written to. */
  injectedSessionId?: string;
}

export interface OllamaChatResponse {
  reply: string;
  /** If the response includes an inject instruction, this is populated. */
  inject?: { sessionId: string; message: string };
  /** If the response includes an improved prompt, this is populated. */
  improvedPrompt?: string;
}
