import { z } from 'zod';
import { UnifiedTool } from './registry.js';
import {
  executeAgyCLI,
  executeAgyJson,
  processChangeModeOutput,
  renderAgyJsonEnvelope,
  formatAgyUsageLine,
  formatConversationLine,
  type AgyCLIOptions,
} from '../utils/agyExecutor.js';
import {
  CLI,
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
  outputFormat: z.enum(["text", "json", "stream-json"]).optional().describe("'text' (default) returns agy's plain answer. 'json' returns agy's JSON envelope rendered as the conversation ID line, the response (or structured_output when jsonSchema is set), and a usage line. 'stream-json' is unsupported."),
  jsonSchema: z.string().optional().describe("Inline JSON Schema passed to agy --json-schema, which constrains the answer to structured_output. Requires outputFormat: 'json'."),
  effort: z.enum(["low", "medium", "high"]).optional().describe("agy --effort, only for models that accept it; tiered Gemini names encode effort in the name ('Gemini 3.8 Flash (High)') and agy rejects --effort for them."),
  includeDirectories: z.union([z.string(), z.array(z.string())]).optional().describe("Additional directories to include in the Antigravity workspace. Comma-separated string or array maps to repeated --add-dir flags."),
  debug: z.boolean().default(false).describe("Unsupported legacy Gemini CLI option. Use agy logs for troubleshooting."),
  printTimeout: z.string().optional().describe("agy --print-timeout duration, such as '5m', '90s', or '10m'. If omitted, agy uses its default."),

  promptInteractive: z.string().optional().describe("Unsupported in MCP request/response mode because it requires an interactive TTY."),
  extensions: z.union([z.string(), z.array(z.string())]).optional().describe("Unsupported legacy Gemini CLI option. Antigravity uses plugins instead of Gemini CLI extensions."),
  resume: z.union([z.boolean(), z.string()]).optional().describe("Resume an agy conversation. true/latest/continue maps to --continue; any other string maps to --conversation <id>."),
  conversationId: z.string().optional().describe("Resume this exact agy conversation (--conversation <id>); wins over `resume`. In outputFormat 'json' the call errors when agy silently starts a different conversation instead of resuming this one. IDs come from the [GEMINI_CONVERSATION_ID=...] line of a previous json call."),
});

export const askGeminiTool: UnifiedTool = {
  name: "ask-gemini",
  description: "Ask Gemini through Antigravity CLI (`agy`) for plan review, implementation critique, code review, architecture feedback, debugging, and tradeoff analysis",
  zodSchema: askGeminiArgsSchema,
  prompt: {
    description: "Ask Gemini through Antigravity CLI (`agy`). Supports file analysis (@syntax), sandbox, yolo permission mode, extra workspace directories, print timeouts, resume by conversation ID, JSON output with an optional response schema, and structured change mode for edit suggestions.",
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
      yolo, approvalMode, outputFormat, jsonSchema, effort, includeDirectories, debug,
      printTimeout, promptInteractive, extensions, resume, conversationId
    } = args; if (!prompt?.trim()) { throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED); }

    if (changeMode && chunkIndex && chunkCacheKey) {
      return processChangeModeOutput(
        '', // empty for cache...
        chunkIndex as number,
        chunkCacheKey as string,
        prompt as string
      );
    }

    const cliOptions: AgyCLIOptions = {
      model: model as string | undefined,
      sandbox: !!sandbox,
      changeMode: !!changeMode,
      yolo: !!yolo,
      approvalMode: approvalMode as string | undefined,
      outputFormat: outputFormat as string | undefined,
      jsonSchema: jsonSchema as string | undefined,
      effort: effort as string | undefined,
      includeDirectories: includeDirectories,
      debug: !!debug,
      printTimeout: printTimeout as string | undefined,
      promptInteractive: promptInteractive as string | undefined,
      extensions: extensions,
      resume: resume as boolean | string | undefined,
      conversationId: conversationId as string | undefined,
      cwd: workingDirectory as string | undefined,
    };

    if (outputFormat === CLI.DEFAULTS.OUTPUT_FORMAT_JSON) {
      const envelope = await executeAgyJson(prompt as string, cliOptions, onProgress);
      const rendered = renderAgyJsonEnvelope(envelope, { hadSchema: Boolean(jsonSchema) });
      return [
        envelope.conversation_id ? formatConversationLine(envelope.conversation_id) : '',
        `${STATUS_MESSAGES.GEMINI_RESPONSE}\n${rendered}`,
        formatAgyUsageLine(envelope),
      ].filter(Boolean).join('\n\n');
    }

    const result = await executeAgyCLI(prompt as string, cliOptions, onProgress);

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
