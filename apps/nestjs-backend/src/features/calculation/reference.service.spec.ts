import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';
import { ReferenceService } from './reference.service';

describe('ReferenceService', () => {
  let service: ReferenceService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReferenceService, PrismaService],
    }).compile();

    service = module.get<ReferenceService>(ReferenceService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const initialNodes = [
      { id: 'f1', value: 1 },
      { id: 'f2', value: 0 },
      { id: 'f3', value: 0 },
      { id: 'f4', value: 0 },
      { id: 'f5', value: 2 },
      { id: 'f6', value: 0 },
      { id: 'f7', value: 0 },
    ];
    const initialReferences = [
      { fromFieldId: 'f1', toFieldId: 'f2' },
      { fromFieldId: 'f2', toFieldId: 'f3' },
      { fromFieldId: 'f2', toFieldId: 'f4' },
      { fromFieldId: 'f3', toFieldId: 'f6' },
      { fromFieldId: 'f5', toFieldId: 'f4' },
    ];

    for (const node of initialNodes) {
      await prisma.nodeValue.create({
        data: {
          id: node.id,
          value: node.value,
        },
      });
    }

    for (const data of initialReferences) {
      await prisma.reference.create({
        data,
      });
    }
  });

  afterEach(async () => {
    // Delete test data
    await prisma.nodeValue.deleteMany({});
    await prisma.reference.deleteMany({});
  });

  it('topological order with dependencies:', async () => {
    const graph = [
      { fromFieldId: 'a', toFieldId: 'c' },
      { fromFieldId: 'b', toFieldId: 'c' },
      { fromFieldId: 'c', toFieldId: 'd' },
    ];

    const sortedNodes = service.getTopologicalOrderRecursive(graph);

    expect(sortedNodes).toEqual([
      { id: 'a', dependencies: [] },
      { id: 'b', dependencies: [] },
      { id: 'c', dependencies: ['a', 'b'] },
      { id: 'd', dependencies: ['c'] },
    ]);
  });

  it('should correctly update node values', async () => {
    // Run the update
    await service.updateNodeValues('f1', 10);

    // Verify the result
    const values = await prisma.nodeValue.findMany();
    expect(values.find((v) => v.id === 'f1')?.value).toBe(10);
    expect(values.find((v) => v.id === 'f2')?.value).toBe(10);
    expect(values.find((v) => v.id === 'f3')?.value).toBe(10);
    expect(values.find((v) => v.id === 'f4')?.value).toBe(12);
  });
});
