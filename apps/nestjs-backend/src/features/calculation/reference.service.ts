import { Injectable } from '@nestjs/common';
import { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class ReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async updateNodeValues(changedFieldId: string, newValue: number): Promise<void> {
    // Get topological order
    const dependentNodes = await this.getDependentNodesCTE(changedFieldId);
    const order = this.getTopologicalOrderRecursive(dependentNodes);
    const initialFieldIds = this.getInitialNodes(dependentNodes);
    const initialNodes = await this.prisma.nodeValue.findMany({
      where: {
        id: {
          in: initialFieldIds,
        },
      },
    });

    // Calculate new values
    const values: Record<string, number> = {};
    for (const node of initialNodes) {
      values[node.id] = node.value;
    }

    values[changedFieldId] = newValue;

    await this.prisma.nodeValue.update({
      where: { id: changedFieldId },
      data: { value: newValue },
    });

    for (const item of order) {
      if (!item.dependencies.length) {
        continue;
      }

      let sum = 0;
      for (const dependency of item.dependencies) {
        sum += values[dependency];
      }
      values[item.id] = sum;

      // Update the node value in the database
      await this.prisma.nodeValue.update({
        where: { id: item.id },
        data: { value: sum },
      });
    }
  }

  getTopologicalOrderRecursive(
    graph: { toFieldId: string; fromFieldId: string }[]
  ): Array<{ id: string; dependencies: string[] }> {
    const visitedNodes = new Set<string>();
    const sortedNodes: Array<{ id: string; dependencies: string[] }> = [];

    function visit(node: string) {
      if (!visitedNodes.has(node)) {
        visitedNodes.add(node);

        const incomingEdges = graph.filter((edge) => edge.toFieldId === node);
        const dependencies: string[] = [];

        for (const edge of incomingEdges) {
          dependencies.push(edge.fromFieldId);
          visit(edge.fromFieldId);
        }

        sortedNodes.push({ id: node, dependencies });
      }
    }

    const allNodes = new Set<string>();
    for (const edge of graph) {
      allNodes.add(edge.fromFieldId);
      allNodes.add(edge.toFieldId);
    }

    for (const node of allNodes) {
      visit(node);
    }

    return sortedNodes;
  }

  async getDependentNodesCTE(startFieldId: string) {
    const dependentNodesQuery = Prisma.sql`
      WITH RECURSIVE connected_reference(from_field_id, to_field_id) AS (
        SELECT from_field_id, to_field_id FROM reference WHERE from_field_id = ${startFieldId} OR to_field_id = ${startFieldId}
        UNION
        SELECT deps.from_field_id, deps.to_field_id
        FROM reference deps
        JOIN connected_reference cd
          ON (deps.from_field_id = cd.from_field_id AND deps.to_field_id != cd.to_field_id) 
          OR (deps.from_field_id = cd.to_field_id AND deps.to_field_id != cd.from_field_id) 
          OR (deps.to_field_id = cd.from_field_id AND deps.from_field_id != cd.to_field_id) 
          OR (deps.to_field_id = cd.to_field_id AND deps.from_field_id != cd.from_field_id)
      )
      SELECT DISTINCT from_field_id, to_field_id FROM connected_reference;
    `;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const result = await this.prisma.$queryRaw<{ from_field_id: string; to_field_id: string }[]>(
      dependentNodesQuery
    );
    return result.map((row) => ({ fromFieldId: row.from_field_id, toFieldId: row.to_field_id }));
  }

  getInitialNodes(graph: { toFieldId: string; fromFieldId: string }[]): string[] {
    const nodesWithIncomingEdges = new Set<string>();

    for (const edge of graph) {
      nodesWithIncomingEdges.add(edge.toFieldId);
    }

    const allNodes = new Set<string>();
    for (const edge of graph) {
      allNodes.add(edge.fromFieldId);
      allNodes.add(edge.toFieldId);
    }

    const initialNodes: string[] = [];
    for (const node of allNodes) {
      if (!nodesWithIncomingEdges.has(node)) {
        initialNodes.push(node);
      }
    }

    return initialNodes;
  }
}
