# Pi Integration Setup

mnemonic integrates with pi at three layers. Each can be installed **globally** (all projects) or **project-local** (per-repo).

## MCP Server

Exposes typed tools (`query`, `get`, `multi_get`, `status`) over stdio.

### Global (all sessions)

Add to `~/.pi/agent/mcp.json`:

```json
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

### Project-local (per repo)

Add to `.pi/mcp.json` in the project root (same format). Only active when pi is in that directory.

## Pi Skill

Lets the agent run `mne search`, `mne query`, `mne get` etc. via bash.

### Global (all sessions)

Copy the skill directory:

```bash
cp -r /path/to/mnemonic/skills/mnemonic ~/.pi/agent/skills/mnemonic
```

Or link the npm package's skill for auto-updates:

```bash
ln -s $(npm root -g)/@naveenadi/mnemonic/SKILL.md ~/.pi/agent/skills/mnemonic/SKILL.md
```

### Project-local (per repo)

```bash
mkdir -p .pi/skills
cp -r /path/to/mnemonic/skills/mnemonic .pi/skills/mnemonic
```

Or via `settings.json`:

```json
{
  "skills": ["../.pi/skills"]
}
```

### Via npm package

The skill ships in the npm tarball (`SKILL.md`). If you install `@naveenadi/mnemonic` as a project dependency, reference it in `.pi/settings.json`:

```json
{
  "skills": ["node_modules/@naveenadi/mnemonic"]
}
```

## Pi Extension

Registers 4 custom tools (`mnemonic_search`, `mnemonic_query`, `mnemonic_get`, `mnemonic_status`) with `pi.registerTool()`.

### Global (all sessions)

```bash
mkdir -p ~/.pi/agent/extensions/mnemonic
cp src/pi-extension/index.ts ~/.pi/agent/extensions/mnemonic/index.ts
```

### Project-local (per repo)

```bash
mkdir -p .pi/extensions/mnemonic
cp src/pi-extension/index.ts .pi/extensions/mnemonic/index.ts
```

### Via npm package (as pi package)

Can be installed as a pi package for auto-discovery. See [pi packages docs](https://pi.dev/docs/packages).

## Quick reference

| Layer | Global path | Project-local path |
|---|---|---|
| MCP config | `~/.pi/agent/mcp.json` | `.pi/mcp.json` |
| Skill | `~/.pi/agent/skills/mnemonic/` | `.pi/skills/mnemonic/` |
| Extension | `~/.pi/agent/extensions/mnemonic/` | `.pi/extensions/mnemonic/` |
