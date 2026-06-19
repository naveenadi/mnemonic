# mnemonic — Domain Glossary

## Core Concepts

**Index** — A SQLite database (`.sqlite`) containing all collections, documents, chunks, vectors, links, tags, and contexts. Lives at `~/.cache/mnemonic/index.sqlite` by default, or a per-project path via `--db`.

**Collection** — A named directory of markdown files, registered in the index. Has a glob pattern (default `**/*.md`), optional ignore patterns, and an `includeByDefault` flag that controls whether it participates in unqualified searches.

**Document** — A single markdown file in a collection. Identified by a 6-char content hash (`docid`). Has a content hash (`checksum`), title (from first H1 or filename), frontmatter (YAML), and tags.

**Chunk** — A heading-aware segment of a document, sized at ~900 tokens with smart boundaries (headings > horizontal rules > blank lines > list items > line breaks). Each chunk gets its own vector embedding.

**Search Pipeline** — The orchestration that takes a user query through: query expansion → HyDE generation → BM25 (FTS5) + vector search per variant → RRF fusion → LLM reranking → time decay → link boost → context resolution.

**Search Backend** — One of two retrieval engines:
- **FTS** (Full-Text Search) — SQLite FTS5 with porter tokenizer, BM25 ranking
- **Vector** — `sqlite-vec` virtual table, cosine similarity via `vec0`

**LLM Backend** — An abstraction over two providers: **Ollama** (HTTP to local server) and **node-llama-cpp** (self-contained GGUF model). Provides `embed`, `rerank`, `expandQuery`, and `generateHyde`.

**Link Graph** — Directed graph of wikilinks (`[[target]]`) and markdown links between documents, stored in the `links` table. Supports backlinks and orphan detection.

**Context Tree** — Hierarchical metadata stored as `(collection, path, text)` tuples, resolved by path prefix matching. Provides per-directory context that auto-attaches to search results.

**Tag** — A label on a document, sourced from frontmatter `tags:` or added manually. Stored in a separate `tags` table for aggregation and filtering.

## Query Model

**ExpandedQuery** — A typed sub-query with a `type` (lex, vec, hyde) and `query` string. Multiple expanded queries run in parallel against the appropriate backend.

**RRF Fusion** — Reciprocal Rank Fusion: each sub-query's ranked list contributes `weight / (RRF_K + rank)` to each document's total score. The K constant is 60. Original (non-expanded) queries get 2x weight.

**HyDE** — Hypothetical Document Embeddings: the LLM generates a "document that would answer this query," then its embedding is used as a vector search query.

**Time Decay** — Exponential decay factor `0.5^(age/halfLife)` applied to scores (default half-life 30 days). Blended at 70% original + 30% decayed.

**Link Boost** — Documents with more incoming links get a score multiplier: `1 + 0.2 * (linkCount / maxLinks)`.

## Architecture Layers

**Store Layer** — Low-level SQLite access via `better-sqlite3`. Three modules:
- `MnemonicDB` — connection, schema, vector table management
- `CollectionStore` — collection CRUD
- `DocumentStore` — document CRUD, link extraction, tags, contexts

**Search Layer** — Retrieval and ranking:
- `FTSSearch` — BM25 via FTS5, with LIKE fallback
- `VectorSearch` — cosine similarity via sqlite-vec vec0
- `SearchPipeline` — orchestration: backend dispatch, RRF fusion, reranking, post-processors
- `fusion` — RRF math and position-aware blending with reranker scores

**LLM Layer** — Backend abstraction:
- `factory` — auto-detection and creation
- `OllamaBackend` — HTTP client for Ollama API
- `NodeLlamaBackend` — node-llama-cpp wrapper

**Chunker** — Markdown-aware text segmentation with break-point scoring.

**Bindings** — Three consumer-facing interfaces:
- **CLI** (`cli/`) — 19+ commands split into four seams:
  - **ArgParser** — `string[]` → `ParsedCommand` (typed discriminated union)
  - **CliContext** — Factory that creates `MnemonicDB`, stores, pipeline, and lazy LLM
  - **CommandHandlers** — 6 family modules (collection, search, document, manage, meta, mcp) returning typed domain data
  - **OutputFormatter** — Stateless functions formatting typed results as CLI table, JSON, or markdown
- **MCP Server** (`mcp/server.ts`) — Thin transport layer calling the same CommandHandlers
- **Pi Extension** (`src/pi-extension/index.ts`) — 4 tools + `/mne` command

## CLI Commands

| Command | What it does |
|---|---|
| `init` | Create empty index |
| `collection add/list/remove/show/rename/include/exclude` | Manage collections |
| `index` | Scan files, build FTS5 index |
| `embed` | Generate vector embeddings |
| `search` | BM25-only search |
| `vsearch` | Vector-only search |
| `query` | Full hybrid search (BM25 + vector + HyDE + reranking) |
| `get / multi-get` | Retrieve document(s) |
| `ls` | List files in a collection |
| `status / doctor` | Index health |
| `context add/list/rm` | Manage context tree |
| `tag` | Add manual tag |
| `links / backlinks` | Link graph queries |
| `orphans` | Find unlinked documents |
| `mcp` | Start MCP server (stdio or HTTP) |
