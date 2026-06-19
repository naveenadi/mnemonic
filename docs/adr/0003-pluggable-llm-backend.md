# ADR-0003: Pluggable LLM Backend via Factory Pattern

**Status**: Accepted  
**Date**: 2026-06-20

## Context

mnemonic needs LLM capabilities (embeddings, reranking, query expansion, HyDE) but should work without external network calls. Two viable approaches: Ollama (external HTTP server, requires installation) and node-llama-cpp (self-contained, downloads GGUF models). Users may have one, both, or neither installed.

## Decision

Define an `LLMBackend` interface with five methods (`embed`, `rerank`, `expandQuery`, `generateHyde`, `embeddingDim`, `close`) and implement two adapters:

- **OllamaBackend** — HTTP client to `localhost:11434`
- **NodeLlamaBackend** — native bindings via `node-llama-cpp`

A `detectLLMBackend()` function tries node-llama-cpp first (fastest path — no network), falls back to Ollama. If neither works, search degrades gracefully to BM25-only.

The `SearchPipeline` accepts an optional `LLMBackend` — no LLM means no vector search, no HyDE, no reranking, no expansion.

## Consequences

**Positive**
- Works out of the box with Ollama (most common setup)
- Self-contained path for air-gapped / offline use via node-llama-cpp
- Clear seam for third providers (OpenAI, Anthropic, etc.) — implement the interface
- Degradation is graceful: missing LLM means less relevant results, not errors

**Negative**
- Ollama bindings are synchronous HTTP — slow for batched embeddings
- node-llama-cpp native builds sometimes break on Node version bumps
- Detection logic is eager: it embeds a test string on startup, which can hang if Ollama is stuck
- No per-request routing (e.g., use Ollama for embeddings, node-llama-cpp for reranking)
