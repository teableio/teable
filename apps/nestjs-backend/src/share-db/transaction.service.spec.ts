/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../src/prisma.service';
import { TransactionService } from './transaction.service';

jest.useFakeTimers();

describe('TransactionService', () => {
  let service: TransactionService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionService,
        // Mock the PrismaService
        { provide: PrismaService, useValue: { $transaction: jest.fn() } },
      ],
    }).compile();
    jest.useRealTimers();
    service = module.get<TransactionService>(TransactionService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getTransaction', () => {
    it('should return prismaService if no transactionKey is provided', async () => {
      const result = await service.getTransaction({});
      expect(result).toBe(prismaService);
    });

    it('should throw an error if opCount is not provided', async () => {
      await expect(service.getTransaction({ transactionKey: 'testKey' })).rejects.toThrow(
        "opCount can't be empty"
      );
    });

    it('should create a new transaction if transactionKey is provided and not in cache', async () => {
      const transactionKey = 'testKey';
      const opCount = 1;
      const transactionClient = { $executeRaw: jest.fn() };
      (prismaService.$transaction as jest.Mock).mockImplementationOnce((cb) =>
        cb(transactionClient)
      );

      const result = await service.getTransaction({ transactionKey, opCount });

      expect(result).toBe(transactionClient);
      expect(prismaService.$transaction).toBeCalledTimes(1);
    });

    it('should return existing transaction if transactionKey is in cache', async () => {
      const transactionKey = 'testKey';
      const opCount = 1;
      const transactionClient = { $executeRaw: jest.fn() };
      (prismaService.$transaction as jest.Mock).mockImplementationOnce((cb) =>
        cb(transactionClient)
      );

      // First call to create the transaction and put it in cache
      await service.getTransaction({ transactionKey, opCount });

      // Second call should return the cached transaction
      const result = await service.getTransaction({ transactionKey, opCount });

      expect(result).toBe(transactionClient);
      expect(prismaService.$transaction).toBeCalledTimes(1); // Not called again
    });

    it('should wait for transaction client if it is not ready yet', async () => {
      const transactionKey = 'testKey';
      const opCount = 1;
      const transactionClient = { $executeRaw: jest.fn() };
      (prismaService.$transaction as jest.Mock).mockImplementationOnce((cb) => {
        setTimeout(() => cb(transactionClient), 100); // Delay the creation of the transaction client
        return Promise.resolve();
      });

      // Call getTransaction and run all timers
      const promise = service.getTransaction({ transactionKey, opCount });
      const result = await promise;

      expect(result).toBe(transactionClient);
    });
  });
  describe('taskComplete', () => {
    it('should complete the task and resolve the transaction promise if all tasks are completed', async () => {
      const transactionKey = 'testKey';
      const opCount = 1;
      const transactionClient = { $executeRaw: jest.fn() };
      (prismaService.$transaction as jest.Mock).mockImplementationOnce((cb) =>
        cb(transactionClient)
      );

      // Create the transaction
      await service.getTransaction({ transactionKey, opCount });

      // Complete the task
      const isTransactionCompleted = await service.taskComplete(null, { transactionKey, opCount });

      expect(isTransactionCompleted).toBe(true);
    });

    it('should not complete the transaction if not all tasks are completed', async () => {
      const transactionKey = 'testKey';
      const opCount = 2; // Two tasks
      const transactionClient = { $executeRaw: jest.fn() };
      (prismaService.$transaction as jest.Mock).mockImplementationOnce((cb) =>
        cb(transactionClient)
      );

      // Create the transaction
      await service.getTransaction({ transactionKey, opCount });

      // Complete one task
      const isTransactionCompleted = await service.taskComplete(null, {
        transactionKey,
        opCount: 1,
      });

      expect(isTransactionCompleted).toBe(false);
    });
  });

  describe('waitClient', () => {
    it('should return the transaction client if it is ready', async () => {
      const transactionKey = 'testKey';
      const opCount = 1;
      const transactionClient = { $executeRaw: jest.fn() };
      (prismaService.$transaction as jest.Mock).mockImplementationOnce((cb) =>
        cb(transactionClient)
      );

      // Create the transaction
      await service.getTransaction({ transactionKey, opCount });

      // Wait for the client
      const result = await service['waitClient'](transactionKey);

      expect(result).toBe(transactionClient);
    });
  });

  describe('newTransaction', () => {
    it('should create a new transaction and add it to the cache', async () => {
      const transactionKey = 'testKey';
      const opCount = 1;
      const transactionClient = { $executeRaw: jest.fn() };
      (prismaService.$transaction as jest.Mock).mockImplementationOnce((cb) =>
        cb(transactionClient)
      );

      // Call the private method directly
      const result = await (service as any).newTransaction({ transactionKey, opCount });

      expect(result).toBe(transactionClient);
      expect(service['cache'].has(transactionKey)).toBe(true);
    });

    it('should resolve the transaction promise when all tasks are completed', async () => {
      const transactionKey = 'testKey';
      const opCount = 1;
      const transactionClient = { $executeRaw: jest.fn() };
      (prismaService.$transaction as jest.Mock).mockImplementationOnce((cb) =>
        cb(transactionClient)
      );

      // Call the private method directly
      await (service as any).newTransaction({ transactionKey, opCount });

      // Complete the task
      await service.taskComplete(null, { transactionKey, opCount });

      // The transaction should be removed from the cache
      expect(service['cache'].has(transactionKey)).toBe(false);
    });
  });
});
