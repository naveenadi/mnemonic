# ADR-0004: Structured Query Fields for Deliberate Retrieval

**Status**: Accepted  
**Date**: 2026-06-20

## Context

Knowledge base queries are often underspecified — "find the note about metrics in cockpit" could mean a literal mention of "cockpit" or a conceptual link to "dashboards." Auto-expansion alone (LLM generating alternative phrasings) lacks direction: it doesn't know what to avoid, what domain to stay in, or which concepts are adjacent but wrong.

## Decision

Support four typed query fields that the caller writes explicitly:

| Field | Type | What it does |
|---|---|---|
| `intent:` | Disambiguation | Context to avoid nearby-but-wrong concepts (passed to expansion/HyDE but not searched directly) |
| `lex:` | BM25 | Exact keyword search — titles, code symbols, proper names, rare terms |
| `vec:` | Vector | Semantic search — paraphrase the idea in natural language |
| `hyde:` | HyDE | A hypothetical document that would answer the request — embedded and vector-searched |

At least `intent:` plus one of `lex:`/`vec:` is required. The caller (not the LLM) writes these — the SKILL.md explicitly warns "Do not delegate this to the expansion model."

When the MCP server receives queries, it accepts typed sub-queries directly. The CLI also parses the structured field syntax from raw strings.

## Consequences

**Positive**
- The caller injects domain knowledge the LLM doesn't have — what to include, what to exclude
- Each field maps to a specific retrieval backend with known behavior
- Intent field steers expansion and HyDE without polluting the result set
- Same mechanism works for CLI, MCP, and SDK consumers

**Negative**
- Higher caller effort than a single string query
- Users who don't read the skill docs write single-string queries and get worse results
- No validation that intent/lex/vec/hyde fields are coherent with each other
- Structured field parsing in the CLI is regex-based and fragile (whitespace, multi-line values)
