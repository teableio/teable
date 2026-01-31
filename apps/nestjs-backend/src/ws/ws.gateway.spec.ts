/* eslint-disable @typescript-eslint/no-explicit-any */
import type { HttpServer } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Mock } from 'vitest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ShareDbService } from '../share-db/share-db.service';
import { WsGateway } from './ws.gateway';

// Mock sockjs
vi.mock('sockjs', () => {
  return {
    default: {
      createServer: vi.fn(() => ({
        on: vi.fn(),
        installHandlers: vi.fn(),
      })),
    },
  };
});

// Mock @an-epiphany/websocket-json-stream
vi.mock('@an-epiphany/websocket-json-stream', () => {
  return {
    WebSocketJSONStream: vi.fn(function (this: any) {
      this.on = vi.fn();
      this.pipe = vi.fn();
      return this;
    }),
  };
});

describe('WsGateway', () => {
  let gateway: WsGateway;
  let shareDbService: { listen: Mock; close: Mock };
  let mockHttpAdapterHost: { httpAdapter: { getHttpServer: Mock } };
  let mockHttpServer: HttpServer;
  let mockSockjsServer: { on: Mock; installHandlers: Mock };

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock sockjs server
    mockSockjsServer = {
      on: vi.fn(),
      installHandlers: vi.fn(),
    };

    // Update the sockjs mock to return our mock server
    const sockjs = await import('sockjs');
    (sockjs.default.createServer as Mock).mockReturnValue(mockSockjsServer);

    // Create mock HTTP server with event emitter capabilities
    mockHttpServer = {
      on: vi.fn(),
    } as unknown as HttpServer;

    // Create mock HttpAdapterHost
    mockHttpAdapterHost = {
      httpAdapter: {
        getHttpServer: vi.fn().mockReturnValue(mockHttpServer),
      },
    };

    // Create mock ShareDbService
    shareDbService = {
      listen: vi.fn(),
      close: vi.fn((callback) => callback()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WsGateway,
        {
          provide: ShareDbService,
          useValue: shareDbService,
        },
        {
          provide: HttpAdapterHost,
          useValue: mockHttpAdapterHost,
        },
      ],
    }).compile();

    gateway = module.get<WsGateway>(WsGateway);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should create sockjs server and install handlers', async () => {
      const sockjs = await import('sockjs');

      gateway.onModuleInit();

      expect(sockjs.default.createServer).toHaveBeenCalledWith({
        prefix: '/socket',
        transports: ['websocket', 'xhr-streaming'],
        response_limit: 2 * 1024 * 1024,
        log: expect.any(Function),
      });
      expect(mockSockjsServer.on).toHaveBeenCalledWith('connection', expect.any(Function));
      expect(mockSockjsServer.installHandlers).toHaveBeenCalledWith(mockHttpServer);
    });

    it('should log messages based on severity', async () => {
      const sockjs = await import('sockjs');
      let logFn: (severity: string, message: string) => void;

      (sockjs.default.createServer as Mock).mockImplementation((options) => {
        logFn = options.log;
        return mockSockjsServer;
      });

      gateway.onModuleInit();

      // Test log function with different severities
      const loggerSpy = vi.spyOn((gateway as any).logger, 'error');
      const logSpy = vi.spyOn((gateway as any).logger, 'log');
      const debugSpy = vi.spyOn((gateway as any).logger, 'debug');

      logFn!('error', 'error message');
      expect(loggerSpy).toHaveBeenCalledWith('error message');

      logFn!('info', 'info message');
      expect(logSpy).toHaveBeenCalledWith('info message');

      logFn!('debug', 'debug message');
      expect(debugSpy).toHaveBeenCalledWith('debug message');
    });
  });

  describe('handleConnection', () => {
    it('should handle null connection gracefully', () => {
      gateway.onModuleInit();

      // Get the connection handler
      const connectionHandler = mockSockjsServer.on.mock.calls.find(
        (call) => call[0] === 'connection'
      )?.[1];

      expect(connectionHandler).toBeDefined();

      // Should not throw when connection is null
      expect(() => connectionHandler(null)).not.toThrow();
    });

    it('should set up close handler for connection', () => {
      gateway.onModuleInit();

      const mockConn = {
        on: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
        _session: { recv: { request: {} } },
      };

      // Call handleConnection directly to avoid mock timing issues
      (gateway as any).handleConnection(mockConn);

      // Verify close handler was set up
      expect(mockConn.on).toHaveBeenCalledWith('close', expect.any(Function));

      // Get close handler and call it
      const closeHandler = mockConn.on.mock.calls.find((call) => call[0] === 'close')?.[1];
      closeHandler();

      // Verify connection was removed from active connections
      expect((gateway as any).activeConnections.has(mockConn)).toBe(false);
    });

    it('should call shareDb.listen with stream and request', () => {
      gateway.onModuleInit();

      const mockRequest = { headers: { cookie: 'test' } };
      const mockConn = {
        on: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
        _session: { recv: { request: mockRequest } },
      };

      // Call handleConnection directly to avoid mock timing issues
      (gateway as any).handleConnection(mockConn);

      expect(shareDbService.listen).toHaveBeenCalledWith(expect.any(Object), mockRequest);
    });

    it('should handle connection error and close connection', async () => {
      gateway.onModuleInit();

      const mockConn = {
        on: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
        _session: { recv: { request: {} } },
      };

      // Make WebSocketJSONStream throw an error
      const wsJsonStreamModule = await import('@an-epiphany/websocket-json-stream');
      (wsJsonStreamModule.WebSocketJSONStream as unknown as Mock).mockImplementationOnce(() => {
        throw new Error('Stream error');
      });

      // Call handleConnection directly to avoid mock timing issues
      (gateway as any).handleConnection(mockConn);

      expect(mockConn.write).toHaveBeenCalledWith(expect.stringContaining('error'));
      expect(mockConn.close).toHaveBeenCalled();
      expect((gateway as any).activeConnections.has(mockConn)).toBe(false);
    });
  });

  describe('onModuleDestroy', () => {
    it('should close all active connections', async () => {
      gateway.onModuleInit();

      const mockConn1 = {
        on: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
        _session: { recv: { request: {} } },
      };
      const mockConn2 = {
        on: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
        _session: { recv: { request: {} } },
      };

      const connectionHandler = mockSockjsServer.on.mock.calls.find(
        (call) => call[0] === 'connection'
      )?.[1];

      connectionHandler(mockConn1);
      connectionHandler(mockConn2);

      await gateway.onModuleDestroy();

      expect(mockConn1.close).toHaveBeenCalled();
      expect(mockConn2.close).toHaveBeenCalled();
      expect((gateway as any).activeConnections.size).toBe(0);
    });

    it('should close shareDb', async () => {
      gateway.onModuleInit();

      await gateway.onModuleDestroy();

      expect(shareDbService.close).toHaveBeenCalled();
    });

    it('should clear sockjsServer reference', async () => {
      gateway.onModuleInit();

      expect((gateway as any).sockjsServer).not.toBeNull();

      await gateway.onModuleDestroy();

      expect((gateway as any).sockjsServer).toBeNull();
    });

    it('should handle shareDb close error gracefully', async () => {
      const closeError = new Error('Close error');
      shareDbService.close.mockImplementation((callback) => callback(closeError));

      gateway.onModuleInit();

      // Should not throw
      await expect(gateway.onModuleDestroy()).resolves.not.toThrow();
    });

    it('should handle connection close error gracefully', async () => {
      gateway.onModuleInit();

      const mockConn = {
        on: vi.fn(),
        write: vi.fn(),
        close: vi.fn().mockImplementation(() => {
          throw new Error('Close error');
        }),
        _session: { recv: { request: {} } },
      };

      // Call handleConnection directly to avoid mock timing issues
      (gateway as any).handleConnection(mockConn);

      // Should not throw
      await expect(gateway.onModuleDestroy()).resolves.not.toThrow();
    });
  });
});
