# mnemonic

On-device hybrid search for markdown knowledge bases. BM25 + vector + LLM reranking with link graphs, time decay, and HyDE. Designed for [pi](https://github.com/earendil-works/pi) coding agent.

## Quick Start

### Global mode (default)

All collections share one index at `~/.cache/mnemonic/index.sqlite`. Search everything at once.

```bash
npm install -g @naveenadi/mnemonic
mne init
mne collection add ~/notes --name notes
mne index
mne embed
mne query "what was the Q4 planning discussion"
```

### Project-local mode

Use `--db` for a per-repo index. Keeps project docs separate.

```bash
mne --db .mnemonic/index.sqlite init
mne --db .mnemonic/index.sqlite collection add . --name myproject
mne --db .mnemonic/index.sqlite index
mne --db .mnemonic/index.sqlite embed
mne --db .mnemonic/index.sqlite query "deploy steps"
```

## Features

- **Hybrid search** — BM25 (FTS5) + Vector embeddings + RRF fusion
- **Structured queries** — `intent:`, `lex:`, `vec:`, `hyde:` fields for deliberate retrieval
- **Query expansion** — LLM generates alternative phrasings for better recall
- **HyDE** — Hypothetical Document Embeddings
- **LLM reranking** — Cross-encoder re-ranks top candidates with position-aware blending
- **Link graph** — Wikilinks, backlinks, orphan detection, link boosting
- **Time decay** — Exponential recency weighting (favor recent notes)
- **Tagging** — Manual + frontmatter auto-parse
- **Context tree** — Hierarchical metadata (`mne://` virtual paths)
- **Smart chunking** — Markdown heading-aware boundaries
- **Dual LLM backend** — Ollama (default) or node-llama-cpp (self-contained GGUF models)

## Pi Integration

Three layers plus an interactive setup command, each installable **globally** (all projects) or **per project**.

| Layer | What | Global path | Per-project path |
|---|---|---|---|
| **Interactive** | `/mne init` walks through setup | — | — |
| **MCP server** | Typed tools: `query`, `get`, `multi_get`, `status` | `~/.pi/agent/mcp.json` | `.pi/mcp.json` |
| **Pi skill** | Bash commands via `SKILL.md` | `~/.pi/agent/skills/mnemonic/` | `.pi/skills/mnemonic/` |
| **Pi extension** | 4 tools + `/mne` command via `pi.registerTool/Command` | `~/.pi/agent/extensions/mnemonic/` | `.pi/extensions/mnemonic/` |

### Interactive setup (extension required)

After installing the extension and running `/reload`, type:

```
/mne init
```

This walks through: scope (global vs project) → add directories → index → embed → configure MCP → install skill.

Other commands: `/mne add <path>`, `/mne status`, `/mne help`.

### MCP — global

```json
// ~/.pi/agent/mcp.json
{
  "mcpServers": {
    "mnemonic": {
      "command": "mne",
      "args": ["mcp"],
      "lifecycle": "keep-alive"
    }
  }
}
```

### MCP — per project

Same config in `.pi/mcp.json` (project root).

### Skill — global

```bash
mkdir -p ~/.pi/agent/skills/mnemonic
cp SKILL.md ~/.pi/agent/skills/mnemonic/
```

### Skill — per project

```bash
mkdir -p .pi/skills/mnemonic
cp SKILL.md .pi/skills/mnemonic/
```

### Extension — global

```bash
mkdir -p ~/.pi/agent/extensions/mnemonic
cp src/pi-extension/index.ts ~/.pi/agent/extensions/mnemonic/
```

### Extension — per project

```bash
mkdir -p .pi/extensions/mnemonic
cp src/pi-extension/index.ts .pi/extensions/mnemonic/
```

## Architecture

```
                    Core SDK (@naveenadi/mnemonic)
    Store (SQLite FTS5 + vec)  |  Search Pipeline  |  Chunker
                    LLM Backend (Ollama <-> node-llama-cpp)
                    Link Graph  |  Time Decay  |  HyDE
```

```
Query ──► HyDE ──► Query Expansion ──► BM25 + Vector (per variant)
                   │
                   └──► RRF Fusion ──► Reranking ──► Time Decay ──► Link Boost ──► Results
```

## CLI Commands

```bash
mne init                     Initialize index
mne collection add <dir>     Add a collection
mne collection list          List collections
mne index                    Index all collections
mne embed                    Generate vector embeddings
mne search <query>           BM25 full-text search
mne vsearch <query>          Vector semantic search
mne query <query>            Hybrid search (BM25 + vector + reranking)
mne get <#docid|path>        Retrieve a document
mne multi-get <pattern>      Batch retrieve
mne ls [collection]          List files
mne status                   Show index status
mne doctor                   Diagnostic checks
mne context add <path> <txt> Add context metadata
mne tag <#docid> <tag>       Add a tag
mne links <#docid>           Show outgoing links
mne backlinks <#docid>       Show incoming links
mne orphans                  Find orphan documents
mne mcp                      Start MCP server
```

## References

- `SKILL.md` — Pi skill for agentic workflows (dig loop, cross-reference, setup)
- `references/setup.md` — Detailed CLI setup and diagnostics
- `references/pi-integration.md` — Pi integration: MCP, skill, extension (both modes)
- `references/link-graph.md` — Cross-reference commands and usage
- `src/pi-extension/` — Pi extension source + standalone package.json

## License

MIT
