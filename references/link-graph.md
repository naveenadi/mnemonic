# Cross-Reference Reference

mnemonic tracks wikilinks (`[[target]]`) and markdown links (`[text](target.md)`) between documents in the `links` table.

## Commands

```bash
mne links #abc123               # Outgoing — what this doc links to
mne backlinks #abc123           # Incoming — what links to this doc
mne orphans                     # Documents with zero links (no incoming or outgoing)
```

## Link boosting in search

Pass `--boost-links` to `mne query` to boost results proportional to their backlink count. Documents with more incoming links rank higher:

```bash
mne query "deployment strategy" --boost-links
```

## Use cases

- **Discover connected context**: after `mne get`, run `mne backlinks` to find related docs.
- **Surface hubs**: `mne query "..." --boost-links` promotes widely cited documents.
- **Find dead ends**: `mne orphans` surfaces disconnected notes that may need linking.
