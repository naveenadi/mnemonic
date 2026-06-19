# Setup Reference

## Global mode (default)

All collections share one index at `~/.cache/mnemonic/index.sqlite`. Search everything at once.

```bash
npm install -g @naveenadi/mnemonic
mne init
mne collection add ~/notes --name notes
mne collection add ~/Documents --name docs --mask "**/*.md"
mne index
mne embed
```

## Project-local mode

Use `--db` for a per-repo index. Index and data stay in the repo.

```bash
mne --db .mnemonic/index.sqlite init
mne --db .mnemonic/index.sqlite collection add . --name myproject
mne --db .mnemonic/index.sqlite index
mne --db .mnemonic/index.sqlite query "something in this repo"
```

## Diagnostics

```bash
mne doctor    # Check models, Ollama, DB health
mne status    # Index health, collection stats, vector status
```

## Maintenance

```bash
mne index     # Re-scan all files, update FTS5 (safe to re-run)
mne embed     # Generate vectors for unembedded documents (-f to force redo)
```
