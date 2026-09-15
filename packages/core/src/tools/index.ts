import { editFileTool } from './edit';
import { globTool } from './glob';
import { grepTool } from './grep';
import { listDirTool } from './list';
import { readFileTool } from './read';
import { todoWriteTool } from './todo';
import type { Tool } from './types';
import { writeFileTool } from './write';

export * from './types';
export { validateArgs } from './schema';
export { readFileTool, writeFileTool, editFileTool, listDirTool, globTool, grepTool, todoWriteTool };
export { CodeIndex, searchCodeTool, tokenize, type CodeIndexOptions, type SearchHit } from './search';

/** Tools that work on any Workspace (disk or in-memory). Shell and web tools are added by the Node layer. */
export function fileTools(): Tool[] {
  return [readFileTool, editFileTool, writeFileTool, listDirTool, globTool, grepTool, todoWriteTool];
}
