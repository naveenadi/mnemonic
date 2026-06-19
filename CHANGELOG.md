# Changelog

## [Unreleased]

### Changed

- **Split CLI monolith** — extracted four seams from the 915-line `commands.ts`:
  - `ArgParser` — typed discriminated union for all 19 commands
  - `CommandHandlers` — 6 family modules returning typed data (no stdout/side effects)
  - `OutputFormatter` — stateless format functions (CLI table, JSON, markdown)
  - `CliContext` — factory for DB + stores + lazy LLM detection
  - `commands.ts` shrunk from 915 to 225 lines (thin dispatch only)
- **Unified MCP server with CLI handlers** — MCP server now uses `CliContext` factory and shares `handleGet` / `handleMultiGet` with the CLI. Server shrunk from 408 to 323 lines.
- **Error handling** — all handlers throw typed `CliError` instead of inline `process.exit`. Caught by dispatch layer.
- **`require('yaml')` removed** — fixed ESM compatibility bug in `parseFrontmatter` (used `require` in a module with `"type": "module"`). Now uses top-level ESM import.
- **Updated `CONTEXT.md`** — domain glossary now documents the CLI binding layer seams.

### Added

- `CONTEXT.md` — domain glossary with all core concepts, query model, architecture layers, and CLI commands
- `docs/adr/0001-sqlite-storage-engine.md` — SQLite + FTS5 + sqlite-vec decision
- `docs/adr/0002-rrf-hybrid-search.md` — RRF fusion for hybrid search
- `docs/adr/0003-pluggable-llm-backend.md` — factory pattern for Ollama / node-llama-cpp
- `docs/adr/0004-structured-query-fields.md` — intent/lex/vec/hyde query fields
- `docs/adr/0005-heading-aware-chunking.md` — break-point scoring for markdown segmentation

## [0.2.3] — 2026-06-20

### Added

- `--version` flag

## [0.2.2] — 2026-06-20

### Fixed

- `mne init` creates parent directory for `--db` path

## [0.2.1] — 2026-06-20

### Fixed

- `--db` flag before subcommand now works correctly

## [0.2.0] — 2026-06-20

### Added

- `/mne` command for interactive setup via pi extension
- Documentation for global vs project-local pi integration (MCP, skill, extension)

### Changed

- Rewrote `SKILL.md` using leading-word methodology
- Renamed package to `@naveenadi/mnemonic`

## [0.1.0] — 2026-06-20

### Added

- Initial release — on-device hybrid search for markdown knowledge bases
- BM25 (FTS5) + vector embeddings + RRF fusion
- LLM reranking with position-aware blending
- HyDE (Hypothetical Document Embeddings)
- Query expansion via LLM
- Heading-aware semantic chunking
- Link graph (wikilinks, backlinks, orphans)
- Time decay scoring
- CLI (`mne search`, `mne query`, `mne get`, etc.)
- MCP server (stdio and HTTP transport)
- Pi extension (4 tools + `/mne` command)
- Dual LLM backend: Ollama and node-llama-cpp
