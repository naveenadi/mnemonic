#!/usr/bin/env node
import { main } from './commands.js';

main(process.argv.slice(2)).catch((err: Error) => {
  console.error('Error:', err.message);
  process.exit(1);
});
