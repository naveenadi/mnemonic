---
name: mnemonic
description: Search local indexed markdown knowledge bases. Use when the user asks to find notes, dig up a concept from personal docs, cross-reference ideas across wikis, or answer from indexed local files. Triggers on "look up in notes", "search my docs", "what did I write about", "find in my vault", "check my index", "retrieve from mne".
license: MIT
compatibility: Requires `@naveenadi/mnemonic` CLI. Install via `npm install -g @naveenadi/mnemonic`.
metadata:
  version: "0.1.0"
allowed-tools: Bash(mne:*)
---

# mnemonic — dig your local index

mnemonic runs searches against a local SQLite index of markdown files — notes, docs, wikis, vaults. Three branches: **dig** (the loop), **setup** (add collections), **cross-reference** (follow links between documents). Most runs only need the dig loop.

## Dig loop

Run through every time. Every **dig** completes when the answer cites the documents it came from — **docid** and **line numbers** on every claim.

```bash
# 1. Check what's indexed
mne status
```

```bash
# 2. Find candidates
# Exact terms? Use BM25:
mne search "cockpit OKR Goodhart" -n 5

# Concept, vague wording, or the user paraphrases? Use hybrid with structured fields:
mne query $'intent: Find the concept note about metrics as instruments without replacing judgment.\nlex: cockpit instruments OKR Goodhart metrics\nvec: data informed not metric driven product judgment\nhyde: A concept note explains metrics are cockpit instruments that should inform, not drive, product judgment.'
```

Structured query fields:
- `intent:` what you're trying to find **and what to avoid**
- `lex:` exact terms, titles, code symbols, rare words
- `vec:` paraphrase of the idea in natural language
- `hyde:` a hypothetical document that would answer the request

Always write `intent:` plus at least one of `lex:`/`vec:`. You know the domain and what to dodge — do not delegate this to the expansion model.

```bash
# 3. Retrieve matched documents
# Results carry a docid (#abc123) and mne:// path
mne get "#abc123"
mne get "#abc123:120:40"       # 40 lines from line 120
mne multi-get "#abc123,#def432" --json

# Output is line-numbered by default; cite line numbers with every claim
```

**Completion criterion**: every claim backed by a docid and line numbers. Do not answer from snippets alone — fetch the source.

```bash
# 4. Scope collections when results drift
mne query "headcount autonomous agents" -c concepts -n 10
mne ls concepts                 # List files in a collection
```

## Cross-reference

After digging, follow links between documents to find connected context.

```bash
mne links #abc123               # Outgoing wikilinks
mne backlinks #abc123           # Incoming (what links here)
mne orphans                     # Documents with no links at all
mne query "deploy" --boost-links  # Prefer well-linked docs
```

See [references/link-graph.md](references/link-graph.md) for full cross-reference commands.

## Setup

Never mutate the index unprompted. Only do this when the user asks to add a collection, index a new directory, or run diagnostics.

### Quick setup via pi

If the pi extension is loaded, type `/mne init` — it asks questions interactively:

```
/mne init
  → Choose global or project-local scope
  → Enter directories to index
  → Index + embed (if Ollama available)
  → Optionally configure MCP, copy skill
```

### Manual setup

```bash
npm install -g @naveenadi/mnemonic
mne init
mne collection add ~/notes --name notes
mne index                        # Scan files, build FTS5
mne embed                        # Generate vector embeddings
```

See [references/setup.md](references/setup.md) for project-local `--db` mode, diagnostics, and maintenance.

### Pi integration

mnemonic integrates at three pi layers — MCP, skill, and extension. Each can be installed globally (all projects) or project-local (per repo).

| Layer | Global | Per project |
|---|---|---|
| MCP | `~/.pi/agent/mcp.json` | `.pi/mcp.json` |
| Skill | `~/.pi/agent/skills/mnemonic/` | `.pi/skills/mnemonic/` |
| Extension | `~/.pi/agent/extensions/mnemonic/` | `.pi/extensions/mnemonic/` |

Full instructions at [references/pi-integration.md](references/pi-integration.md).

## Pitfalls

- **Fetch before claiming.** Snippets are leads, not sources.
- **Do not shell-slice files.** Use `:from:count` suffix (e.g. `#abc123:120:40`) — never `sed`, `head`, `tail`.
- **Do not lean on auto-expansion.** Write `intent:`/`lex:`/`vec:`/`hyde:` yourself. A bare `mne query "user sentence"` discards context only you have.
- **Prefer BM25 for exact terms.** Semantic search is slower and drifts. If you know the title, `mne search "title"` is better.
- **Do not mutate indexes casually.** `mne index` and `mne embed` are expensive.
