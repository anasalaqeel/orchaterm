# Orchaterm E2E Suite

WebdriverIO + tauri-service tests that drive the real packaged app.

## Run

```bash
bun run e2e:build   # once, or after app changes — builds src-tauri/target/debug/orchaterm-e2e.exe
bun run test:e2e    # runs every e2e/specs/*.spec.js sequentially, fresh app per spec
```

## How it works

- **Sandboxed app**: the build overlay (`src-tauri/tauri.e2e.conf.json`) changes the app
  identifier to `com.orchaterm.app.e2e`, so the app under test reads/writes its own
  `%APPDATA%\com.orchaterm.app.e2e\` — your real settings are never touched.
  `e2e/helpers/seed.mjs` writes fixtures there before each spec.
- **Feature-gated test hooks**: `tauri-plugin-wdio` + `tauri-plugin-wdio-webdriver` are
  compiled only with the `wdio` Cargo feature (passed by `bun run e2e:build`), and
  `src/main.tsx` only loads the WDIO frontend bridge in `--mode e2e` builds. Default and
  release builds carry none of it.
- **No real LLM needed**: `e2e/mocks/llm-server.mjs` is an OpenAI-compatible server with
  deterministic, prompt-routed replies (the app points at it via the seeded settings).
- **Fake agent**: `e2e/fixtures/fake-agent.mjs` logs every stdin line it receives —
  the handover spec uses its log to prove the resume prompt crossed the PTY.
- **One spec, one app**: `e2e/run-all.mjs` runs each spec as its own `wdio` invocation
  because the tauri-service keeps a single app alive across spec files otherwise.

## Notes

- Terminal typing goes through an xterm paste event (see `e2e/helpers/ui.mjs`):
  WebDriver key actions double-process in xterm v6, and the WebGL renderer keeps
  text out of the DOM, so shell assertions are file-based.
- `e2e/.tmp/` holds runtime artifacts (markers, screenshots, fixture workspace) and is
  gitignored.
