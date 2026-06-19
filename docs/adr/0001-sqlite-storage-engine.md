# ADR-0001: SQLite as the Single Storage Engine

**Status**: Accepted  
**Date**: 2026-06-20 (inferred from project inception)

## Context

mnemonic needs to store documents, chunks, embeddings, link graphs, tags, and metadata — all locally on-device, with no external services. The store must support full-text search (FTS5) and vector similarity search in the same database for transactional consistency across index updates.

## Decision

Use SQLite via `better-sqlite3` as the single storage engine, with two virtual table extensions layered on top:

1. **FTS5** — for BM25 full-text search with `porter unicode61` tokenizer
2. **sqlite-vec** (`vec0`) — for cosine similarity vector search in the same database file

All related data (documents ↔ chunks ↔ vectors ↔ links ↔ tags) lives in the same SQLite file, enforced by foreign keys with `ON DELETE CASCADE`. WAL journal mode enables concurrent reads during indexing.

## Consequences

**Positive**
- Single file to back up, move, or delete
- ACID transactions across document updates, chunking, link extraction, and tag management
- No external vector database (Pinecone, Qdrant, etc.) — fully offline
- FTS5 triggers auto-sync the full-text index on document insert/update/delete

**Negative**
- sqlite-vec is less mature than dedicated vector databases (limited index types, no HNSW)
- All data fits in a single file — very large vaults (>100k docs) may hit SQLite write throughput limits
- sqlite-vec is a native extension; the darwin-arm64 build is bundled as optional, other platforms need manual install
