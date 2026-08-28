# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Solo software engineers who run multiple terminal sessions, build processes, and autonomous AI coding tools (Claude Code, Antigravity, Hermes, Aider, etc.) at once on their own machine. Their job: stop manually copy-pasting context and switching windows between shells, build runners, and AI agents.

## Product Purpose

Orchaterm is a next-generation developer terminal: a full-fidelity, GPU-accelerated terminal emulator (PTY, split grids, ANSI rendering) with an ambient orchestration layer on top. It watches, summarizes, and coordinates across terminal sessions so context and handoffs flow between shells and AI agents without manual relay. Success = a developer running many concurrent terminals/agents without acting as the messenger between them.

## Positioning

Full terminal fidelity first, ambient orchestration second — not an "AI agent" or agent wrapper. The mechanism a competitor can't casually copy: full native PTY fidelity (no proprietary lock-in) combined with a coordination layer that observes buffer state (Sentinel Protocol), relays context between sessions, and dispatches structured task pipelines — with orchestration itself pluggable across local (Ollama/LM Studio) and cloud (Anthropic, Gemini) models.

## Operating Context

Runs as a Tauri v2 desktop app (React/TypeScript frontend, Rust backend) on Windows/macOS/Linux. Core workflows: managing terminal grids/spaces (PTY sessions, split panes, tabs), an ambient chat/relay feed summarizing what each terminal is doing, visual task pipelines with dependency graphs, and session checkpointing when a process hits context/rate limits.

## Capabilities and Constraints

- Terminal grid via `@xterm/xterm` + `portable-pty`, WebGL rendering, split panes, themes, search, custom keybindings.
- Terminal Spaces: grouping related processes/shells into workspaces.
- Visual Pipelines: dependency graphs, parallel/sequential task dispatch, live progress.
- Live Chat & Relay Feed: real-time per-terminal summaries, cross-session message routing.
- Sentinel Protocol: non-intrusive buffer monitoring to detect idle/thinking/tool-use/awaiting-input state.
- Session Continuation & Checkpoints: detects context/rate-limit exhaustion, generates continuation summaries.
- Prompt Vault & Quick Actions: reusable prompts, one-click commands across sessions.
- LLM orchestration is pluggable: Ollama (default), LM Studio/OpenAI-compatible, Anthropic Claude, Google Gemini.
- Constraint: continuous ambient orchestration makes frequent LLM calls; paid cloud APIs can get expensive fast if left on — product explicitly steers users toward local models as the default and warns on cloud cost.
- Privacy-first, zero telemetry by default.

## Brand Commitments

Name "Orchaterm." Existing wordmark logo (light/dark SVG variants at `src/assets/logos/`).

## Evidence on Hand

No screenshots, demo recordings, benchmarks, or testimonials on hand beyond the README/docs themselves. Future work must not fabricate any of these.

## Product Principles

1. Terminal fidelity is never sacrificed for orchestration features — full PTY, no lock-in, no lost functionality.
2. Ambient, not intrusive: orchestration observes and assists; it doesn't take over the developer's control loop.
3. Local-model-capable by default: every orchestration feature must work with zero-cost local models, not just paid cloud APIs.
4. Reduce manual relay: any workflow that has a developer manually copying context between terminals/agents is a target for the coordination layer to absorb.
