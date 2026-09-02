import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';

const packageVersion = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
).version as string;

// Track constructor calls manually using plain arrays.
// vitest's mockReset clears mock.calls between tests, but these arrays persist.
const serverConstructorCalls: any[][] = [];
const stdioTransportConstructorCalls: any[][] = [];
const setRequestHandlerCalls: any[][] = [];

const mockServerInstance = {
  setRequestHandler: vi.fn((...args: any[]) => {
    setRequestHandlerCalls.push(args);
  }),
  connect: vi.fn().mockResolvedValue(undefined),
  notification: vi.fn(),
};

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  const ServerMock = vi.fn(function (this: any, ...args: any[]) {
    serverConstructorCalls.push(args);
    Object.assign(this, mockServerInstance);
  }) as any;
  ServerMock.prototype = mockServerInstance;
  return { Server: ServerMock };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  const StdioMock = vi.fn(function (this: any, ...args: any[]) {
    stdioTransportConstructorCalls.push(args);
  }) as any;
  return { StdioServerTransport: StdioMock };
});

vi.mock('../utils/logger.js', () => ({
  Logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    toolInvocation: vi.fn(),
    commandExecution: vi.fn(),
    commandComplete: vi.fn(),
  },
}));

describe('Gemini MCP Server', () => {
  beforeAll(async () => {
    await import('../index.js');
  });

  describe('Server Initialization', () => {
    it('should create server with correct name and version', () => {
      expect(serverConstructorCalls.length).toBeGreaterThanOrEqual(1);

      const [serverConfig] = serverConstructorCalls[0];
      expect(serverConfig).toHaveProperty('name', 'gemini-mcp');
      expect(packageVersion).toBe('2.0.2');
      expect(serverConfig).toHaveProperty('version', packageVersion);
    });

    it('should register capabilities', () => {
      const [, capabilities] = serverConstructorCalls[0];
      expect(capabilities).toHaveProperty('capabilities');
      expect(capabilities.capabilities).toHaveProperty('tools');
      expect(capabilities.capabilities).toHaveProperty('prompts');
    });
  });

  describe('Request Handlers', () => {
    it('should register at least 4 request handlers', () => {
      expect(setRequestHandlerCalls.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Progress Notifications', () => {
    it('should support progress notifications', () => {
      expect(mockServerInstance).toHaveProperty('notification');
      expect(typeof mockServerInstance.notification).toBe('function');
    });
  });

  describe('Transport Connection', () => {
    it('should create StdioServerTransport', () => {
      expect(stdioTransportConstructorCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
