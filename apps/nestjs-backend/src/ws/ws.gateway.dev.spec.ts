/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConfigService } from '@nestjs/config';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Mock } from 'vitest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ShareDbService } from '../share-db/share-db.service';
import { DevWsGateway } from './ws.gateway.dev';

// Mock http module
vi.mock('http', () => {
  const mockServer = {
    on: vi.fn(),
    close: vi.fn((callback) => callback()),
    listen: vi.fn((port, callback) => callback()),
  };
  return {
    default: {
      createServer: vi.fn(() => mockServer),
    },
    createServer: vi.fn(() => mockServer),
  };
});

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

describe('DevWsGateway', () => {
  let gateway: DevWsGateway;
  let shareDbService: { listen: Mock; close: Mock };
  let configService: { get: Mock };
  let mockSockjsServer: { on: Mock; installHandlers: Mock };
  let mockHttpServer: { on: Mock; close: Mock; listen: Mock };

  const testPort = 3001;

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock sockjs server
    mockSockjsServer = {
      on: vi.fn(),
      installHandlers: vi.fn(),
    };

    // Create mock HTTP server
    mockHttpServer = {
      on: vi.fn(),
      close: vi.fn((callback) => callback()),
      listen: vi.fn((port, callback) => callback()),
    };

    // Update mocks
    const sockjs = await import('sockjs');
    (sockjs.default.createServer as Mock).mockReturnValue(mockSockjsServer);

    const http = await import('http');
    (http.default.createServer as Mock).mockReturnValue(mockHttpServer);

    // Create mock ConfigService
    configService = {
      get: vi.fn().mockReturnValue(testPort),
    };

    // Create mock ShareDbService
    shareDbService = {
      listen: vi.fn(),
      close: vi.fn((callback) => callback()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevWsGateway,
        {
          provide: ShareDbService,
          useValue: shareDbService,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
      ],
    }).compile();

    gateway = module.get<DevWsGateway>(DevWsGateway);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should get port from config service', async () => {
      gateway.onModuleInit();

      expect(configService.get).toHaveBeenCalledWith('SOCKET_PORT');
    });

    it('should create standalone HTTP server', async () => {
      const http = await import('http');

      gateway.onModuleInit();

      expect(http.default.createServer).toHaveBeenCalled();
    });

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

    it('should set up error handler for HTTP server', async () => {
      gateway.onModuleInit();

      expect(mockHttpServer.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should listen on configured port', async () => {
      gateway.onModuleInit();

      expect(mockHttpServer.listen).toHaveBeenCalledWith(testPort, expect.any(Function));
    });
  });

  describe('handleConnection', () => {
    it('should handle null connection gracefully', () => {
      gateway.onModuleInit();

      const connectionHandler = mockSockjsServer.on.mock.calls.find(
        (call) => call[0] === 'connection'
      )?.[1];

      expect(connectionHandler).toBeDefined();
      expect(() => connectionHandler(null)).not.toThrow();
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

    it('should use empty request if session.recv.request is undefined', () => {
      gateway.onModuleInit();

      const mockConn = {
        on: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
        _session: undefined,
      };

      // Call handleConnection directly to avoid mock timing issues
      (gateway as any).handleConnection(mockConn);

      expect(shareDbService.listen).toHaveBeenCalledWith(expect.any(Object), expect.any(Object));
    });
  });

  describe('handleServerError', () => {
    it('should log HTTP server errors', () => {
      gateway.onModuleInit();

      const errorHandler = mockHttpServer.on.mock.calls.find((call) => call[0] === 'error')?.[1];

      expect(errorHandler).toBeDefined();

      const loggerSpy = vi.spyOn((gateway as any).logger, 'error');
      const testError = new Error('Test HTTP error');
      testError.stack = 'Test stack trace';

      errorHandler(testError);

      expect(loggerSpy).toHaveBeenCalledWith('HTTP server error', 'Test stack trace');
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

    it('should close shareDb and HTTP server in parallel', async () => {
      gateway.onModuleInit();

      await gateway.onModuleDestroy();

      expect(shareDbService.close).toHaveBeenCalled();
      expect(mockHttpServer.close).toHaveBeenCalled();
    });

    it('should clear sockjsServer and httpServer references', async () => {
      gateway.onModuleInit();

      expect((gateway as any).sockjsServer).not.toBeNull();
      expect((gateway as any).httpServer).not.toBeNull();

      await gateway.onModuleDestroy();

      expect((gateway as any).sockjsServer).toBeNull();
      expect((gateway as any).httpServer).toBeNull();
    });

    it('should handle shareDb close error gracefully', async () => {
      const closeError = new Error('ShareDb close error');
      closeError.stack = 'ShareDb stack trace';
      shareDbService.close.mockImplementation((callback) => callback(closeError));

      gateway.onModuleInit();

      const loggerSpy = vi.spyOn((gateway as any).logger, 'error');

      await gateway.onModuleDestroy();

      expect(loggerSpy).toHaveBeenCalledWith('ShareDb close error', 'ShareDb stack trace');
    });

    it('should handle HTTP server close error gracefully', async () => {
      const closeError = new Error('HTTP close error');
      closeError.stack = 'HTTP stack trace';
      mockHttpServer.close.mockImplementation((callback) => callback(closeError));

      gateway.onModuleInit();

      const loggerSpy = vi.spyOn((gateway as any).logger, 'error');

      await gateway.onModuleDestroy();

      expect(loggerSpy).toHaveBeenCalledWith('DevWsGateway close error', 'HTTP stack trace');
    });

    it('should handle missing httpServer gracefully', async () => {
      gateway.onModuleInit();
      (gateway as any).httpServer = null;

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
