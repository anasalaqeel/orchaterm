# Contributing to Orchaterm

Thank you for your interest in contributing to **Orchaterm**! We welcome all contributions from bug fixes and feature improvements to documentation and test coverage.

Please take a moment to review this guide before submitting your pull request.

---

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please treat all contributors and users with respect.

---

## How Can I Contribute?

There are many ways you can contribute to Orchaterm:

- 🐛 **Report Bugs**: Check the [issue tracker](https://github.com/anasalaqeel/orchaterm/issues) first. If it hasn't been reported, open a new issue using our [Bug Report Template](.github/ISSUE_TEMPLATE/bug_report.yml).
- 💡 **Suggest Features**: Propose new ideas or enhancements using our [Feature Request Template](.github/ISSUE_TEMPLATE/feature_request.yml).
- 💻 **Submit Code Changes**: Pick an existing issue, discuss your approach with maintainers, and submit a PR.
- 🎨 **Terminal Themes & UI**: Add new terminal color palettes or improve UI styling in the terminal/conductor panels.
- 🤖 **LLM Providers & Prompts**: Add support for new local/cloud LLM providers or refine conductor and orchestration prompt templates.
- 📝 **Improve Documentation**: Fix typos, add tutorials, expand API docs, or clarify guides.
- 🧪 **Write Tests**: Increase test coverage for frontend components, sentinel parsers, or Rust backend PTY commands.

### Looking for "Good First Issues"?
If you're new to the project, look for issues labeled [`good first issue`](https://github.com/anasalaqeel/orchaterm/labels/good%20first%20issue) or [`help wanted`](https://github.com/anasalaqeel/orchaterm/labels/help%20wanted). These are curated to be accessible entry points to the codebase.

---

## Development Setup

### 1. Prerequisites

- [Bun](https://bun.sh/) (preferred) or [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- Required OS build tools (see [README.md](README.md#-development-setup))

### 2. Fork and Clone

```bash
# Clone your fork
git clone https://github.com/<your-username>/orchaterm.git
cd orchaterm

# Add upstream remote
git remote add upstream https://github.com/anasalaqeel/orchaterm.git
```

### 3. Install Dependencies

```bash
bun install
```

### 4. Run the Development Server

```bash
# Run with full Tauri desktop window
bun run tauri dev

# Or run frontend-only in your browser
bun run dev
```

---

## Branching & Commit Guidelines

### Branch Naming
- `feat/feature-name` for new features
- `fix/bug-description` for bug fixes
- `docs/documentation-changes` for docs
- `refactor/clean-up-area` for refactoring

### Commit Messages
We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: add model selector in conductor settings`
- `fix: resolve PTY resize deadlock on Windows`
- `docs: update LLM provider configuration instructions`
- `test: add unit test for buffer watcher sentinel detection`
- `refactor: simplify terminal theme state handling`

---

## Testing & Quality Checklist

Before submitting your PR, ensure that:

1. **All tests pass**:
   ```bash
   bun run test
   ```
2. **Code is properly formatted**:
   ```bash
   bun run format
   ```
3. **TypeScript builds cleanly**:
   ```bash
   bun run build
   ```
4. **Rust backend compiles cleanly**:
   ```bash
   cd src-tauri && cargo check && cargo test
   ```

---

## Pull Request Process

1. **Keep PRs focused**: Each PR should address a single bug or feature.
2. **Include tests**: Add unit or integration tests for new functionality or regression tests for bug fixes.
3. **Update documentation**: If your change adds UI features, config options, or architectural changes, update the relevant documentation.
4. **Fill out the PR template**: Complete all sections of the PR template with clear descriptions of the change and how to test it.

---

## Contributor Recognition

All contributors who have code, documentation, bug reports, or design changes merged into Orchaterm are automatically featured on our [Contributors Wall](README.md#-contributors) and acknowledged in release notes.

---

## Questions & Support

Feel free to open an issue for questions, or join discussions on [GitHub Discussions](https://github.com/anasalaqeel/orchaterm/discussions). Thank you for making Orchaterm better for everyone!
