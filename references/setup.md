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

## Pi integration (all three layers)

Each layer — MCP server, skill, extension — can be installed globally or per project.

### MCP server

```bash
# Global: add to ~/.pi/agent/mcp.json
{
  "mcpServers": {
    "mnemonic": {
      "command": "mne",
      "args": ["mcp"],
      "lifecycle": "keep-alive"
    }
  }
}

# Per project: same format in .pi/mcp.json
```

### Skill

```bash
# Global
mkdir -p ~/.pi/agent/skills/mnemonic
cp SKILL.md ~/.pi/agent/skills/mnemonic/

# Per project (auto-discovered after trust)
mkdir -p .pi/skills/mnemonic
cp SKILL.md .pi/skills/mnemonic/
```

### Extension

```bash
# Global
mkdir -p ~/.pi/agent/extensions/mnemonic
cp src/pi-extension/index.ts ~/.pi/agent/extensions/mnemonic/

# Per project
mkdir -p .pi/extensions/mnemonic
cp src/pi-extension/index.ts .pi/extensions/mnemonic/
```

Full reference: [pi-integration.md](pi-integration.md)

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
