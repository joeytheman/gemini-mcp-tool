import { z } from 'zod';
import { UnifiedTool } from './registry.js';
import { executeAgyCLI, processChangeModeOutput } from '../utils/agyExecutor.js';
import { 
  ERROR_MESSAGES, 
  STATUS_MESSAGES
} from '../constants.js';

export const askGeminiArgsSchema = z.object({
  prompt: z.string().min(1).describe("Analysis request for Gemini feedback. Use @ syntax to include files (e.g., '@largefile.js review this implementation') or ask for plan/code review feedback"),
  model: z.string().optional().describe("Optional Antigravity model name. Defaults to 'Gemini 3.8 Flash (High)'. Other verified options include 'Gemini 3.8 Flash (Low)', 'Gemini 3.8 Flash (Medium)', 'Gemini 3.1 Pro (Low)', and 'Gemini 3.1 Pro (High)'."),
  sandbox: z.boolean().default(false).describe("Use Antigravity sandbox mode (--sandbox) to restrict terminal access"),
  changeMode: z.boolean().default(false).describe("Enable structured change mode - formats prompts to prevent tool errors and returns structured edit suggestions that Claude can apply directly"),
  chunkIndex: z.union([z.number(), z.string()]).optional().describe("Which chunk to return (1-based)"),
  chunkCacheKey: z.string().optional().describe("Optional cache key for continuation"),
  workingDirectory: z.string().optional().describe("Working directory to run agy from. Use drive root (e.g., 'C:/' or 'D:/') to access files on that drive."),

  yolo: z.boolean().default(false).describe("Map to agy --dangerously-skip-permissions. Auto-approves all tool permission requests without prompting. Use with caution."),
  approvalMode: z.enum(["default", "auto_edit", "yolo"]).optional().describe("Legacy Gemini CLI option. Only 'yolo' is supported and maps to --dangerously-skip-permissions; other values return an explicit error."),
  outputFormat: z.enum(["text", "json", "stream-json"]).optional().describe("Unsupported legacy Gemini CLI option. agy --print currently returns text output."),
  includeDirectories: z.union([z.string(), z.array(z.string())]).optional().describe("Additional directories to include in the Antigravity workspace. Comma-separated string or array maps to repeated --add-dir flags."),
  debug: z.boolean().default(false).describe("Unsupported legacy Gemini CLI option. Use agy logs for troubleshooting."),
  printTimeout: z.string().optional().describe("agy --print-timeout duration, such as '5m', '90s', or '10m'. If omitted, agy uses its default."),

  promptInteractive: z.string().optional().describe("Unsupported in MCP request/response mode because it requires an interactive TTY."),
  extensions: z.union([z.string(), z.array(z.string())]).optional().describe("Unsupported legacy Gemini CLI option. Antigravity uses plugins instead of Gemini CLI extensions."),
  resume: z.union([z.boolean(), z.string()]).optional().describe("Resume an agy conversation. true/latest/continue maps to --continue; any other string maps to --conversation <id>."),
});

export const askGeminiTool: UnifiedTool = {
  name: "ask-gemini",
  description: "Ask Gemini through Antigravity CLI (`agy`) for plan review, implementation critique, code review, architecture feedback, debugging, and tradeoff analysis",
  zodSchema: askGeminiArgsSchema,
  prompt: {
    description: "Ask Gemini through Antigravity CLI (`agy`). Supports file analysis (@syntax), sandbox, yolo permission mode, extra workspace directories, print timeouts, resume, and structured change mode for edit suggestions.",
  },
  category: 'gemini',
  annotations: {
    title: "Ask Gemini",
    readOnlyHint: true,
    openWorldHint: true,
  },
  execute: async (args, onProgress) => {
    const {
      prompt, model, sandbox, changeMode, chunkIndex, chunkCacheKey, workingDirectory,
      yolo, approvalMode, outputFormat, includeDirectories, debug,
      printTimeout, promptInteractive, extensions, resume
    } = args; if (!prompt?.trim()) { throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED); }
  
    if (changeMode && chunkIndex && chunkCacheKey) {
      return processChangeModeOutput(
        '', // empty for cache...
        chunkIndex as number,
        chunkCacheKey as string,
        prompt as string
      );
    }
    
    const result = await executeAgyCLI(
      prompt as string,
      {
        model: model as string | undefined,
        sandbox: !!sandbox,
        changeMode: !!changeMode,
        yolo: !!yolo,
        approvalMode: approvalMode as string | undefined,
        outputFormat: outputFormat as string | undefined,
        includeDirectories: includeDirectories,
        debug: !!debug,
        printTimeout: printTimeout as string | undefined,
        promptInteractive: promptInteractive as string | undefined,
        extensions: extensions,
        resume: resume as boolean | string | undefined,
        cwd: workingDirectory as string | undefined,
      },
      onProgress
    );
    
    if (changeMode) {
      return processChangeModeOutput(
        result,
        args.chunkIndex as number | undefined,
        undefined,
        prompt as string
      );
    }
    return `${STATUS_MESSAGES.GEMINI_RESPONSE}\n${result}`; // changeMode false
  }
};
