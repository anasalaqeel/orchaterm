# Orchaterm

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="src/assets/logos/wordmark-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="src/assets/logos/wordmark-light.svg">
  <img alt="Orchaterm Logo" src="src/assets/logos/wordmark-light.svg" width="600">
</picture>

**The Next-Generation Terminal Built for the AI Era of Software Engineering**

[![CI](https://github.com/anasalaqeel/orchaterm/actions/workflows/ci.yml/badge.svg)](https://github.com/anasalaqeel/orchaterm/actions/workflows/ci.yml)
[![Release](https://github.com/anasalaqeel/orchaterm/actions/workflows/release.yml/badge.svg)](https://github.com/anasalaqeel/orchaterm/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2.0-24C8D8?logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-Stable-DEA584?logo=rust&logoColor=black)](https://www.rust-lang.org/)

[Vision](#-a-new-generation-of-terminals) •
[Features](#-key-features) •
[Quick Start](#-quick-start) •
[Architecture](#-architecture) •
[LLM Providers](#-supported-llm-providers) •
[Development](#-development-setup) •
[Contributing](#-contributing)

</div>

---

## 🌟 A New Generation of Terminals

> **Orchaterm is not an AI agent, and it is not an "agents terminal."**  
> **It is simply a new generation of developer terminals designed from the ground up to adopt the way the programming industry has changed to use AI.**

For over fifty years, the terminal was designed around a single assumption: a single human typing sequential commands into a single shell prompt.

The software engineering industry has fundamentally changed. Today, developers juggle build runners, local servers, CLI tools, and autonomous AI coding partners (Claude Code, Antigravity, Hermes, Aider, etc.) across multiple active windows simultaneously. Working across these tools often requires manual copy-pasting, constant context switching, and fragmented workflows.

**Orchaterm represents the natural evolution of the developer terminal:**

- ⚡ **Full Terminal Fidelity First**: Underneath the intelligence is a blazing-fast, GPU-accelerated terminal emulator with full PTY support, customizable keybindings, split grids, and ANSI color rendering. No features lost, no proprietary lock-in.
- 🧠 **Ambient Intelligence & Coordination**: Rather than acting as a rigid wrapper, Orchaterm provides an ambient orchestration layer. It can watch, understand, summarize, and coordinate between any number of terminal sessions.
- 🔄 **Context Flow Without the Copy-Paste**: Tasks, summaries, and handoffs can move fluidly between developer shells, build processes, and AI agents through a unified coordination bridge.
- 🔓 **Unlocking the True Value of Small Local Models**: Let's be honest—previously, it was hard to find a genuinely practical, everyday use case for smaller, local AI models. Orchaterm finally changes that. By using lightweight local models (via Ollama or LM Studio) to handle continuous terminal observation, state detection, and rapid summarization, these "weak" models become incredibly valuable, high-speed coordinators that run completely offline without API costs. (Cloud APIs like Anthropic and Gemini are also fully supported).

---

## 💡 The Problem Orchaterm Solves

When running multiple AI coding tools and build processes across isolated terminal windows, developers end up acting as manual messengers between them. 

Orchaterm eliminates that friction:
- **Zero Loss of CLI Fidelity**: Full native PTY instances with interactive hotkeys and WebGL acceleration.
- **Automated Observation**: An ambient LLM orchestrator observes terminal buffers, summarizes activity, and detects agent state.
- **Autonomous Relay & Conductor**: Decompose complex goals into subtasks, dispatch them to specific terminals, and relay context automatically.
- **Continuous Checkpointing**: Automatically capture context checkpoints when processes hit rate or context limits so workflows resume instantly.

---

## 🚀 Key Features

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                ORCHATERM                                    │
│                                                                             │
│  ┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────┐  │
│  │   Terminal Panel      │ │     Chat Panel        │ │  Conductor Panel  │  │
│  │                       │ │                       │ │                   │  │
│  │ • PTY Sessions        │ │ • Unified LLM stream  │ │ • Goal breakdown  │  │
│  │ • Split Panes & Tabs  │ │ • Cross-agent relay   │ │ • Task dispatch   │  │
│  │ • WebGL Acceleration  │ │ • Agent status cards  │ │ • Execution graph │  │
│  │ • Sentinel Detection  │ │ • User command bridge │ │ • Checkpoint/Save │  │
│  └───────────────────────┘ └───────────────────────┘ └───────────────────┘  │
│                                                                             │
│               Coordination Layer (Ollama / Local / Cloud LLMs)               │
└─────────────────────────────────────────────────────────────────────────────┘
```

- 🖥️ **High-Performance Terminal Grid**: Powered by `@xterm/xterm` and `portable-pty` with WebGL rendering, split panes, customizable themes, search, and native keybindings.
- 🤖 **Agent Grouping**: Group terminals running specific CLI agents into coordinated teams.
- 🎯 **Conductor Mode**: Create structured task plans from natural language goals, assign tasks to specific agent terminals, and monitor automated execution.
- 💬 **Live Chat & Relay Window**: Observe what each agent is working on via real-time summaries and send directives that get routed directly to active terminals.
- 🛡️ **Sentinel Protocol & State Detection**: Non-intrusively monitors buffer outputs to determine whether an agent is idle, thinking, invoking tools, or awaiting input.
- 💾 **Session Continuation & Checkpoints**: Detect context window exhaustion or rate limits and generate structured continuation summaries ready for the next session.
- ⚡ **Prompt Vault & Quick Actions**: Manage reusable prompts and execute quick one-click commands across sessions.
- 🔒 **Privacy-First & Local LLM Native**: First-class support for Ollama and LM Studio with zero telemetry; optional support for Anthropic Claude and Google Gemini.

---

## 📦 Quick Start

### 1. Download Pre-built Binaries

Download the latest release for Windows, macOS, or Linux from the [**Releases**](https://github.com/anasalaqeel/orchaterm/releases) page.

### 2. Configure Your LLM Orchestrator

Orchaterm can use a local or cloud LLM provider to power orchestration:

1. Open **Settings** (⚙️) in Orchaterm.
2. Select your preferred provider:
   - **Ollama** (Default, e.g. `http://localhost:11434` with `qwen2.5-coder:7b` or `llama3.2`)
   - **LM Studio / OpenAI Compatible** (`http://localhost:1234/v1`)
   - **Anthropic Claude** *(See high cost warning below)*
   - **Google Gemini** *(See high cost warning below)*
3. Test the connection and start orchestrating!

---

## 🛠️ Supported LLM Providers

| Provider | Type | Recommended Models | Description |
| :--- | :--- | :--- | :--- |
| **Ollama** | Local / Offline | `qwen2.5-coder`, `llama3.2`, `mistral` | Fast, private, zero-cost local orchestration. |
| **LM Studio** | Local / Offline | Any OpenAI-compatible local model | Standard `/v1/chat/completions` endpoint. |
| **Anthropic** | Cloud API | `claude-3-5-sonnet`, `claude-3-5-haiku` | High-reasoning cloud orchestration. |
| **Google Gemini**| Cloud API | `gemini-2.0-flash`, `gemini-1.5-pro` | Low-latency, large-context orchestration. |

> [!WARNING]
> **High Cost Warning for Paid Cloud APIs**
> Orchaterm's ambient orchestration works by continuously reading your active terminal buffers and making frequent, high-volume LLM requests behind the scenes to summarize state, parse logs, and track context. 
> 
> If you configure a paid, usage-based cloud API (like Anthropic Claude or Google Gemini) as your orchestrator, **it will rapidly consume a massive amount of tokens and can result in surprisingly high, unexpected API costs** (unless continuous orchestration is turned off in Settings).
> 
> We strongly recommend using local, zero-cost models (via Ollama or LM Studio) as your primary orchestration engine.

---

## 💻 Development Setup

### Prerequisites

- **Node.js** (v18+) or [**Bun**](https://bun.sh/) (recommended)
- [**Rust**](https://www.rust-lang.org/tools/install) (stable toolchain)
- **C++ Build Tools / OS Dependencies**:
  - **Linux (Ubuntu/Debian)**:
    ```bash
    sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
    ```
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Microsoft Visual Studio C++ Build Tools

### Installation & Running Locally

1. **Clone the repository**:
   ```bash
   git clone https://github.com/anasalaqeel/orchaterm.git
   cd orchaterm
   ```

2. **Install dependencies**:
   ```bash
   bun install
   # or npm install
   ```

3. **Run in desktop development mode** (starts Vite + Tauri app):
   ```bash
   bun run tauri dev
   # or npm run tauri dev
   ```

4. **Run frontend-only mode** (for UI/component development):
   ```bash
   bun run dev
   ```

---

## 🧪 Testing & Code Quality

```bash
# Run unit and integration tests (Vitest)
bun run test

# Run tests in watch mode
bun run test:watch

# Format code with Prettier
bun run format

# Run Rust backend checks
cd src-tauri && cargo check && cargo test
```

---

## 🗺️ Project Architecture

```
orchaterm/
├── src/                      # React frontend
│   ├── components/           # UI components (Terminal, Chat, Conductor, etc.)
│   ├── hooks/                # Custom React hooks
│   ├── services/             # Core business logic (LLM providers, PTY, sentinel, checkpoints)
│   ├── tests/                # Vitest test suite
│   ├── types/                # TypeScript interface and type definitions
│   └── utils/                # Utility helpers
├── src-tauri/                # Rust backend (Tauri v2)
│   ├── src/                  # PTY management, process spawning, OS IPC
│   ├── Cargo.toml            # Rust dependencies & metadata
│   └── tauri.conf.json       # Tauri window & bundle configuration
├── .github/                  # GitHub Actions CI/CD workflows and issue templates
└── docs/                     # Comprehensive architecture and specification guides
```

For a deeper dive into internal mechanics, see:
- [Architecture & Implementation Guide](ORCHATERM_ARCHITECTURE.md)
- [User Guide & Operations Manual](ORCHATERM_USER_GUIDE.md)
- [Session Continuation Workflow](SESSION_CONTINUATION_WORKFLOW.md)

---

## 🤝 Contributing & Community

Contributions are what make the open-source community an inspiring place to learn, build, and create. Any contribution—large or small—is **greatly appreciated**!

- 📖 Check our [**Contributing Guide**](CONTRIBUTING.md) to get started with local development, code standards, and PR workflows.
- 💬 Join [**GitHub Discussions**](https://github.com/anasalaqeel/orchaterm/discussions) to ask questions, suggest ideas, or share setups.
- 🐛 Found a bug? Open a [**Bug Report**](https://github.com/anasalaqeel/orchaterm/issues/new?template=bug_report.yml).
- 💡 Have a feature idea? Submit a [**Feature Request**](https://github.com/anasalaqeel/orchaterm/issues/new?template=feature_request.yml).
- 📜 Read our [**Code of Conduct**](CODE_OF_CONDUCT.md).

### 👥 Contributors

Thank you to all the wonderful contributors who help build and improve Orchaterm!

<a href="https://github.com/anasalaqeel/orchaterm/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=anasalaqeel/orchaterm" alt="Contributors" />
</a>

---

## 🛡️ Security

If you discover a security vulnerability within Orchaterm, please review our [**Security Policy**](SECURITY.md) to report it responsibly.

---

## 📄 License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.

<div align="center">
Made with ❤️ for AI engineers and developers.
</div>
