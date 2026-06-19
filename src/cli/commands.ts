import { readFileSync } from 'node:fs';
import { parseArgs, CliGlobalOptions, ParsedCommand } from './arg-parser.js';
import { createContext, resolveLLM, destroyContext, CliContext } from './context-factory.js';
import { formatHelp, formatResult, formatMessage, formatIndexProgress, formatEmbedProgress } from './output-formatter.js';
import { formatCollectionList } from './output-formatter.js';
import { CliError } from './errors.js';
import {
  handleCollectionList,
  handleCollectionShow,
  handleCollectionAdd,
  handleCollectionRemove,
  handleCollectionRename,
  handleCollectionInclude,
  handleCollectionExclude,
  handleSearch,
  handleVectorSearch,
  handleQuery,
  handleGet,
  handleMultiGet,
  handleLs,
  handleInit,
  handleAdd,
  handleIndex,
  handleEmbed,
  handleStatus,
  handleDoctor,
  handleAddTag,
  handleLinks,
  handleBacklinks,
  handleOrphans,
  handleContextAdd,
  handleContextList,
  handleContextRemove,
  handleMcp,
} from './handlers/index.js';

export async function main(rawArgs: string[]) {
  let parsed: { global: CliGlobalOptions; cmd: ParsedCommand };

  try {
    parsed = parseArgs(rawArgs);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
    return;
  }

  const { global, cmd } = parsed;

  // Commands that don't need a DB context
  switch (cmd.command) {
    case 'help':
      console.log(formatHelp());
      return;
    case 'version': {
      const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as any;
      console.log(`mnemonic v${pkg.version}`);
      return;
    }
    case 'doctor': {
      const info = await handleDoctor();
      console.log(formatResult(info, cmd));
      return;
    }
  }

  // Commands that need a DB context
  const ctx = createContext(global.dbPath, global.verbose);

  try {
    // Resolve LLM for commands that need it
    if (cmd.command === 'vsearch' || cmd.command === 'query' || cmd.command === 'embed') {
      ctx.llm = await resolveLLM(global.verbose);
    }

    switch (cmd.command) {
      case 'init': {
        console.log(handleInit(ctx));
        break;
      }

      case 'collection': {
        switch (cmd.sub) {
          case 'list':
            console.log(formatCollectionList(handleCollectionList(ctx)));
            break;
          case 'show':
            console.log(formatResult(handleCollectionShow(ctx, cmd.name), cmd));
            break;
          case 'add':
            console.log(formatMessage(handleCollectionAdd(ctx, cmd)));
            break;
          case 'remove':
            console.log(formatMessage(handleCollectionRemove(ctx, cmd.name)));
            break;
          case 'rename':
            console.log(formatMessage(handleCollectionRename(ctx, cmd.oldName, cmd.newName)));
            break;
          case 'include':
            console.log(formatMessage(handleCollectionInclude(ctx, cmd.name)));
            break;
          case 'exclude':
            console.log(formatMessage(handleCollectionExclude(ctx, cmd.name)));
            break;
        }
        break;
      }

      case 'add':
        console.log(formatMessage(handleAdd(ctx, cmd)));
        break;

      case 'index': {
        const results = await handleIndex(ctx, cmd);
        for (const r of results) {
          console.log(r.collection + ':');
          console.log(formatIndexProgress(r.result.indexed, r.result.updated, r.result.unchanged));
        }
        break;
      }

      case 'embed': {
        const result = await handleEmbed(ctx, cmd);
        console.log(formatEmbedProgress(result.embedded, result.skipped, result.failed));
        break;
      }

      case 'search': {
        const results = handleSearch(ctx, cmd);
        console.log(formatResult(results, cmd));
        break;
      }

      case 'vsearch': {
        const results = await handleVectorSearch(ctx, cmd);
        console.log(formatResult(results, cmd));
        break;
      }

      case 'query': {
        const results = await handleQuery(ctx, cmd);
        console.log(formatResult(results, cmd));
        break;
      }

      case 'get': {
        const result = handleGet(ctx, cmd);
        const output = formatResult(result, cmd);
        console.log(output);
        break;
      }

      case 'multi-get': {
        const output = handleMultiGet(ctx, cmd);
        console.log(formatResult(output, cmd));
        break;
      }

      case 'ls': {
        const files = handleLs(ctx, cmd.collection);
        console.log(files.join('\n'));
        break;
      }

      case 'status': {
        const info = await handleStatus(ctx);
        console.log(formatResult(info, cmd));
        break;
      }

      case 'context': {
        switch (cmd.sub) {
          case 'add':
            console.log(formatMessage(handleContextAdd(ctx, cmd.path, cmd.text)));
            break;
          case 'list':
            console.log(formatResult(handleContextList(ctx), cmd));
            break;
          case 'rm':
            console.log(formatMessage(handleContextRemove(ctx, cmd.path)));
            break;
        }
        break;
      }

      case 'tag': {
        console.log(formatMessage(handleAddTag(ctx, cmd.docid, cmd.tag)));
        break;
      }

      case 'links': {
        const links = handleLinks(ctx, cmd.docid);
        console.log(formatResult(links, cmd));
        break;
      }

      case 'backlinks': {
        const links = handleBacklinks(ctx, cmd.docid);
        console.log(formatResult(links, cmd));
        break;
      }

      case 'orphans': {
        const orphans = handleOrphans(ctx);
        console.log(formatResult(orphans, cmd));
        break;
      }

      case 'mcp': {
        await handleMcp(ctx, cmd);
        break;
      }
    }
  } catch (err) {
    if (err instanceof CliError) {
      console.error(err.message);
      process.exit(err.exitCode);
    } else {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    }
  } finally {
    destroyContext(ctx);
  }
}
