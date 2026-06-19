import { homedir } from 'node:os';
import { resolve, join } from 'node:path';

/** Global CLI options */
export interface CliGlobalOptions {
  dbPath: string;
  verbose: boolean;
}

/** Parsed command — discriminated union of all mne subcommands */
export type ParsedCommand =
  | { command: 'init' }
  | { command: 'search'; query: string; collection?: string; limit: number; format: 'cli' | 'json' }
  | { command: 'vsearch'; query: string; collection?: string; limit: number; format: 'cli' | 'json' }
  | { command: 'query'; query?: string; queries?: Array<{ type: 'lex' | 'vec' | 'hyde'; query: string }>; intent?: string; collection?: string; limit: number; format: 'cli' | 'json'; noRerank: boolean; explain: boolean }
  | { command: 'embed'; collection?: string; force: boolean }
  | { command: 'index'; collection?: string }
  | { command: 'collection'; sub: 'add'; name: string; path: string; mask?: string; excluded?: boolean }
  | { command: 'collection'; sub: 'list' }
  | { command: 'collection'; sub: 'remove'; name: string }
  | { command: 'collection'; sub: 'show'; name: string }
  | { command: 'collection'; sub: 'rename'; oldName: string; newName: string }
  | { command: 'collection'; sub: 'include'; name: string }
  | { command: 'collection'; sub: 'exclude'; name: string }
  | { command: 'add'; path: string; name: string; mask?: string }
  | { command: 'get'; identifier: string; fromLine?: number; maxLines?: number; lineNumbers: boolean; fullPath: boolean; format: 'cli' | 'json' }
  | { command: 'multi-get'; pattern: string; maxLines: number; lineNumbers: boolean; format: 'cli' | 'json' }
  | { command: 'ls'; collection?: string }
  | { command: 'status'; format: 'cli' | 'json' }
  | { command: 'doctor' }
  | { command: 'context'; sub: 'add'; path: string; text: string }
  | { command: 'context'; sub: 'list' }
  | { command: 'context'; sub: 'rm'; path: string }
  | { command: 'tag'; docid: string; tag: string }
  | { command: 'links'; docid: string }
  | { command: 'backlinks'; docid: string }
  | { command: 'orphans' }
  | { command: 'mcp'; port?: number; daemon: boolean }
  | { command: 'help' }
  | { command: 'version' };

function getArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx >= 0 && idx < args.length - 1) return args[idx + 1];
  return undefined;
}

function hasArg(args: string[], ...names: string[]): boolean {
  return names.some((n) => args.includes(n));
}

/** Parse raw CLI arguments into a typed ParsedCommand */
export function parseArgs(raw: string[]): { global: CliGlobalOptions; cmd: ParsedCommand } {
  // --version shortcut
  if (raw.includes('--version')) {
    return {
      global: { dbPath: '', verbose: false },
      cmd: { command: 'version' },
    };
  }

  const verbose = raw.includes('--verbose') || raw.includes('-v');
  const dbPath = resolvePath(getArg(raw, '--db') ?? defaultDbPath());

  // Find the command (skip flags)
  let cmdIdx = 0;
  while (cmdIdx < raw.length) {
    const a = raw[cmdIdx];
    if (a === '--db') { cmdIdx += 2; continue; }
    if (a.startsWith('-')) { cmdIdx += 1; continue; }
    break;
  }

  const [command, ...rest] = raw.slice(cmdIdx);

  if (!command || command === 'help' || command === '--help') {
    return { global: { dbPath, verbose }, cmd: { command: 'help' } };
  }

  const cmd = parseCommand(command, rest);
  return { global: { dbPath, verbose }, cmd };
}

function parseCommand(command: string, args: string[]): ParsedCommand {
  switch (command) {
    case 'init':
      return { command: 'init' };

    case 'collection':
      return parseCollection(args);

    case 'add':
      return parseAdd(args);

    case 'index':
    case 'update':
      return {
        command: 'index',
        collection: getArg(args, '--collection') ?? getArg(args, '-c'),
      };

    case 'embed':
      return {
        command: 'embed',
        collection: getArg(args, '--collection') ?? getArg(args, '-c'),
        force: hasArg(args, '--force', '-f'),
      };

    case 'search':
      return {
        command: 'search',
        query: args.join(' ').replace(/ --\S+/g, '').trim(),
        collection: getArg(args, '-c') ?? getArg(args, '--collection'),
        limit: parseInt(getArg(args, '-n') ?? '10', 10),
        format: hasArg(args, '--json') ? 'json' : 'cli',
      };

    case 'vsearch':
      return {
        command: 'vsearch',
        query: args.join(' ').replace(/ --\S+/g, '').trim(),
        collection: getArg(args, '-c') ?? getArg(args, '--collection'),
        limit: parseInt(getArg(args, '-n') ?? '10', 10),
        format: hasArg(args, '--json') ? 'json' : 'cli',
      };

    case 'query': {
      const full = args.join(' ');
      const intentMatch = full.match(/intent:\s*((?:.|\n)*?)(?=\n\w+:|$)/);
      const lexMatch = full.match(/\blex:\s*(.+?)(?=\n\s*(?:vec|hyde|intent):|$)/);
      const vecMatch = full.match(/\bvec:\s*(.+?)(?=\n\s*(?:lex|hyde|intent):|$)/);
      const hydeMatch = full.match(/\bhyde:\s*(.+?)(?=\n\s*(?:lex|vec|intent):|$)/);

      let query: string | undefined;
      let queries: ParsedCommand & { command: 'query' } extends infer P ? P extends { queries?: any } ? any : never : never;

      if (lexMatch || vecMatch || hydeMatch) {
        const parsedQs: Array<{ type: 'lex' | 'vec' | 'hyde'; query: string }> = [];
        if (lexMatch) parsedQs.push({ type: 'lex' as const, query: lexMatch[1].trim() });
        if (vecMatch) parsedQs.push({ type: 'vec' as const, query: vecMatch[1].trim() });
        if (hydeMatch) parsedQs.push({ type: 'hyde' as const, query: hydeMatch[1].trim() });
        queries = parsedQs;
      } else {
        query = full.replace(/ --\S+/g, '').trim();
      }

      return {
        command: 'query',
        query,
        queries: queries as any,
        intent: intentMatch?.[1]?.trim(),
        collection: getArg(args, '-c') ?? getArg(args, '--collection'),
        limit: parseInt(getArg(args, '-n') ?? '10', 10),
        format: hasArg(args, '--json') ? 'json' : 'cli',
        noRerank: hasArg(args, '--no-rerank'),
        explain: hasArg(args, '--explain'),
      };
    }

    case 'get': {
      const identifier = args[0];
      const flagFrom = getArg(args, '--from');
      const flagLines = getArg(args, '-l');

      let fromLine: number | undefined;
      let maxLines: number | undefined;
      let cleanId = identifier;

      if (identifier) {
        const suffixMatch = identifier.match(/^(.+?):(\d+)(?::(\d+))?$/);
        if (suffixMatch) {
          cleanId = suffixMatch[1];
          fromLine = parseInt(suffixMatch[2], 10);
          maxLines = suffixMatch[3] ? parseInt(suffixMatch[3], 10) : undefined;
        }
      }

      if (flagFrom) fromLine = parseInt(flagFrom, 10);
      if (flagLines) maxLines = parseInt(flagLines, 10);

      return {
        command: 'get',
        identifier: cleanId ?? '',
        fromLine,
        maxLines,
        lineNumbers: !hasArg(args, '--no-line-numbers'),
        fullPath: hasArg(args, '--full-path'),
        format: hasArg(args, '--json') ? 'json' : 'cli',
      };
    }

    case 'multi-get':
      return {
        command: 'multi-get',
        pattern: args[0] ?? '',
        maxLines: parseInt(getArg(args, '-l') ?? '50', 10),
        lineNumbers: !hasArg(args, '--no-line-numbers'),
        format: hasArg(args, '--json') ? 'json' : 'cli',
      };

    case 'ls':
      return {
        command: 'ls',
        collection: args[0]?.replace(/^mne:\/\//, ''),
      };

    case 'status':
      return {
        command: 'status',
        format: hasArg(args, '--json') ? 'json' : 'cli',
      };

    case 'doctor':
      return { command: 'doctor' };

    case 'context':
      return parseContext(args);

    case 'tag':
      return {
        command: 'tag',
        docid: (args[0] ?? '').replace(/^#/, ''),
        tag: args[1] ?? '',
      };

    case 'links':
      return {
        command: 'links',
        docid: (args[0] ?? '').replace(/^#/, ''),
      };

    case 'backlinks':
      return {
        command: 'backlinks',
        docid: (args[0] ?? '').replace(/^#/, ''),
      };

    case 'orphans':
      return { command: 'orphans' };

    case 'mcp': {
      const portStr = getArg(args, '--http') ? parseInt(getArg(args, '--port') ?? '8181', 10) : undefined;
      return {
        command: 'mcp',
        port: portStr,
        daemon: hasArg(args, '--daemon'),
      };
    }

    default:
      throw Object.assign(new Error(`Unknown command: ${command}`), { exitCode: 1, name: 'CliError' });
  }
}

function parseCollection(args: string[]): ParsedCommand {
  const sub = args[0];
  switch (sub) {
    case 'add': {
      const path = args[1];
      const name = getArg(args, '--name') ?? args[2];
      return {
        command: 'collection',
        sub: 'add',
        name: name ?? 'default',
        path: resolvePath(path ?? ''),
        mask: getArg(args, '--mask'),
        excluded: hasArg(args, '--excluded'),
      };
    }
    case 'list':
      return { command: 'collection', sub: 'list' };
    case 'remove':
      return { command: 'collection', sub: 'remove', name: args[1] ?? '' };
    case 'show':
      return { command: 'collection', sub: 'show', name: args[1] ?? '' };
    case 'rename':
      return { command: 'collection', sub: 'rename', oldName: args[1] ?? '', newName: args[2] ?? '' };
    case 'include':
      return { command: 'collection', sub: 'include', name: args[1] ?? '' };
    case 'exclude':
      return { command: 'collection', sub: 'exclude', name: args[1] ?? '' };
    default:
      throw Object.assign(new Error('Usage: mne collection <add|list|remove|show|rename|include|exclude> ...'), { exitCode: 1, name: 'CliError' });
  }
}

function parseAdd(args: string[]): ParsedCommand {
  const path = args[0] ?? '';
  const name = getArg(args, '--name') ?? (path ? path.replace(/\/$/, '').split('/').pop() || 'default' : 'default');
  return {
    command: 'add',
    path: resolvePath(path),
    name,
    mask: getArg(args, '--mask'),
  };
}

function parseContext(args: string[]): ParsedCommand {
  const sub = args[0];
  switch (sub) {
    case 'add': {
      const path = args[1] ?? '';
      const text = args.slice(2).join(' ');
      return { command: 'context', sub: 'add', path, text };
    }
    case 'list':
      return { command: 'context', sub: 'list' };
    case 'rm': {
      const path = args[1] ?? '';
      return { command: 'context', sub: 'rm', path };
    }
    default:
      throw Object.assign(new Error('Usage: mne context <add|list|rm> ...'), { exitCode: 1, name: 'CliError' });
  }
}

function defaultDbPath(): string {
  return join(homedir(), '.cache', 'mnemonic', 'index.sqlite');
}

function resolvePath(p: string): string {
  return resolve(p);
}
