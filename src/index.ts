#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  CallToolRequest,
  ListToolsRequest,
  ListPromptsRequest,
  GetPromptRequest,
  Tool,
  Prompt,
  GetPromptResult,
  CallToolResult,
  ServerNotification,
} from "@modelcontextprotocol/sdk/types.js";
import { Logger } from "./utils/logger.js";
import { PROTOCOL, ToolArguments } from "./constants.js";
import { startProgressUpdates, type SendProgress } from "./utils/progressUpdates.js";

import { 
  getToolDefinitions, 
  getPromptDefinitions, 
  executeTool, 
  toolExists, 
  getPromptMessage 
} from "./tools/index.js";

const server = new Server(
  {
    name: "gemini-mcp",
    version: "2.4.0",
  },{
    capabilities: {
      tools: {},
      prompts: {},
    },
  },
);


// Request-scoped: the SDK drops it once the request is cancelled, and the
// client logs progress on a cancelled request's token as an error.
function progressSender(sendNotification: (notification: ServerNotification) => Promise<void>): SendProgress {
  return async (progressToken, progress, total, message) => {
    try {
      await sendNotification({
        method: PROTOCOL.NOTIFICATIONS.PROGRESS,
        params: { progressToken, progress, total, message },
      });
    } catch (error) {
      Logger.error("Failed to send progress notification:", error);
    }
  };
}

// tools/list
server.setRequestHandler(ListToolsRequestSchema, async (request: ListToolsRequest): Promise<{ tools: Tool[] }> => {
  return { tools: getToolDefinitions() as unknown as Tool[] };
});

// tools/get
server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest, extra): Promise<CallToolResult> => {
  const toolName: string = request.params.name;

  if (toolExists(toolName)) {
    // Check if client requested progress updates
    const progressToken = (request.params as any)._meta?.progressToken;
    
    // Start progress updates if client requested them
    const progress = startProgressUpdates(toolName, progressToken, progressSender(extra.sendNotification));
    
    try {
      // Get prompt and other parameters from arguments with proper typing
      const args: ToolArguments = (request.params.arguments as ToolArguments) || {};

      Logger.toolInvocation(toolName, request.params.arguments);

      // Execute the tool using the unified registry with progress callback
      const result = await executeTool(
        toolName,
        args,
        (newOutput) => progress.recordOutput(newOutput),
        extra.signal
      );

      progress.finish('success');

      return {
        content: [
          {
            type: "text",
            text: result,
          },
        ],
        isError: false,
      };
    } catch (error) {
      progress.finish('failure');
      
      Logger.error(`Error in tool '${toolName}':`, error);

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        content: [
          {
            type: "text",
            text: `Error executing ${toolName}: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  } else {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

// prompts/list
server.setRequestHandler(ListPromptsRequestSchema, async (request: ListPromptsRequest): Promise<{ prompts: Prompt[] }> => {
  return { prompts: getPromptDefinitions() as unknown as Prompt[] };
});

// prompts/get
server.setRequestHandler(GetPromptRequestSchema, async (request: GetPromptRequest): Promise<GetPromptResult> => {
  const promptName = request.params.name;
  const args = request.params.arguments || {};
  
  const promptMessage = getPromptMessage(promptName, args);
  
  if (!promptMessage) {
    throw new Error(`Unknown prompt: ${promptName}`);
  }
  
  return { 
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: promptMessage
      }
    }]
  };
});

// Start the server
async function main() {
  Logger.debug("init gemini-mcp-tool");
  const transport = new StdioServerTransport(); await server.connect(transport);
  Logger.debug("gemini-mcp-tool listening on stdio");
} main().catch((error) => {Logger.error("Fatal error:", error); process.exit(1); }); 
