---
name: mnemonic
description: Search local markdown knowledge bases, notes, docs, and wikis with mnemonic. Hybrid BM25 + vector + LLM reranking. Use when users ask to find notes, retrieve documents, or answer from indexed markdown.
license: MIT
compatibility: Requires mnemonic CLI. Install via `npm install -g @naveenadi/mnemonic`. Initialize with `mne init`.
metadata:
  version: "0.1.0"
allowed-tools: Bash(mne:*)
---

# mnemonic — On-Device Hybrid Search

## How search works

mnemonic searches local markdown collections: notes, docs, wikis, and project
knowledge bases. Use it before web search when the answer may already be in
indexed local files.

The workflow is always:

1. Check what's indexed with `mne status`.
2. Search for candidate documents.
3. Retrieve the full source with `mne get` or `mne multi-get`.
4. Answer from retrieved text, citing paths or docids.

Do not answer from snippets alone when the user needs facts, decisions, quotes,
or nuance. Snippets are only leads.

Typical loop:

```bash
mne status
mne query "merchant reality support interviews" -n 5
# leads: #abc123 concepts/customer-proximity.md; #def432 sources/merchant-call.md
mne get "#abc123" --no-line-numbers
```

## Pick the right search mode

Use **BM25 lexical search** when you know exact words, titles, names, code
symbols, or rare phrases:

```bash
mne search "cockpit OKR Goodhart" -n 10
mne search '"AI Before Headcount"' -c concepts -n 5
```

Use **`mne query` with structured fields** when the user describes an idea
indirectly, uses different wording than the source, or needs conceptual recall.
Write the fields yourself rather than leaning on query expansion. Combine exact
anchors with semantic recall:

```bash
mne query $'intent: Find the concept note about metrics as instruments without letting OKRs replace judgment.\nlex: cockpit instruments OKR Goodhart metrics judgment\nvec: data informed not metric driven product judgment\nhyde: A concept note says metrics are useful like cockpit instruments, but leaders should remain data-informed rather than metric-driven because OKRs and dashboards can Goodhart product judgment.'
```

Structured query fields (you author each one):

- `intent:` states what you are trying to find **and what to avoid**. Always
  supply this.
- `lex:` exact terms, aliases, titles, code symbols, and rare words.
- `vec:` paraphrases the idea in natural language.
- `hyde:` a hypothetical document that would answer the request.

You do not need all four every time, but always supply at least `intent:` plus
one of `lex:`/`vec:`.

## Retrieve sources

Search results include docids like `#abc123` and `mne://` paths. Fetch them:

```bash
mne get "#abc123"
mne get mne://concepts/ai-before-headcount.md
mne multi-get "#abc123,#def432" --json
mne get "#abc123:120:40"           # 40 lines starting at line 120
mne get mne://concepts/note.md -l 80 --from 200
```

Output is line-numbered by default and carries the docid:

```text
mne://concepts/note.md  #abc123
---

1: # Metrics as instruments
2:
3: Treat dashboards like cockpit instruments...
```

Cite the docid and exact line numbers in your answer. Pass `--no-line-numbers`
only when you need raw content to copy verbatim.

## Discover what is indexed

```bash
mne collection list
mne ls
mne status
mne ls concepts               # List files in a collection
```

Add collection filters to scope searches:

```bash
mne search "headcount autonomous agents" -c concepts -n 10
mne query "merchant support product reality" -c concepts -c sources -n 10
```

Omit `-c` to search all default-included collections.

## Link graph

mnemonic tracks wikilinks (`[[target]]`) and markdown links between documents:

```bash
mne links #abc123             # Outgoing links
mne backlinks #abc123         # Incoming links (what links to this)
mne orphans                   # Documents with no links at all
```

Use the link graph to discover related context:

```bash
mne query "deployment" --boost-links    # Boost results with many backlinks
```

## Setup and maintenance

Only mutate indexes when the user asked for setup or maintenance.

### Global mode (default)

All collections share one index at `~/.cache/mnemonic/index.sqlite`. Search across everything at once.

```bash
npm install -g @naveenadi/mnemonic
mne init
mne collection add ~/notes --name notes
mne collection add ~/Documents --name docs --mask "**/*.md"
mne index
mne embed
```

### Project-local mode

Use `--db` for a per-repo index. Keeps project docs separate from personal notes.

```bash
mne --db .mnemonic/index.sqlite init
mne --db .mnemonic/index.sqlite collection add . --name myproject
mne --db .mnemonic/index.sqlite index
mne --db .mnemonic/index.sqlite query "something in this repo"
```

Health and diagnostics:

```bash
mne doctor
mne status
```

## Pitfalls

- **Do not stop at snippets.** Fetch documents before making claims.
- **Do not slice files with `sed`/`head`/`tail`.** Use the `path:from:count`
  suffix or `--from`/`-l` flags.
- **Do not lean on auto query expansion.** Write `intent:`/`lex:`/`vec:`/`hyde:`
  yourself when you know the domain context.
- **Do not overuse semantic search.** If you know exact titles or terms,
  `mne search` (BM25) is faster and often better.
- **Do not mutate indexes casually.** `mne index` and `mne embed` change local
  state and can be expensive.
