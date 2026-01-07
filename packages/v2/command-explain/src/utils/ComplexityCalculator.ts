import { injectable } from '@teable/v2-di';

import type {
  ComplexityAssessment,
  ComplexityFactor,
  ComplexityLevel,
  CommandExplainInfo,
  ComputedImpactInfo,
  SqlExplainInfo,
} from '../types';

export type ComplexityInput = {
  commandInfo: CommandExplainInfo;
  computedImpact: ComputedImpactInfo | null;
  sqlExplains: ReadonlyArray<SqlExplainInfo>;
};

/**
 * Calculate complexity assessment for explain results.
 */
@injectable()
export class ComplexityCalculator {
  /**
   * Calculate complexity based on command info, computed impact, and SQL explains.
   */
  calculate(input: ComplexityInput): ComplexityAssessment {
    const factors: ComplexityFactor[] = [];
    let totalScore = 0;

    // Factor 1: Number of records affected
    const recordCount = input.commandInfo.recordIds.length;
    const recordContribution = this.calculateRecordContribution(recordCount);
    factors.push({
      name: 'recordCount',
      value: recordCount,
      contribution: recordContribution,
      description: `${recordCount} record(s) directly affected`,
    });
    totalScore += recordContribution;

    // Factor 2: Number of changed fields
    const changedFieldCount = input.commandInfo.changedFieldIds?.length ?? 0;
    const fieldContribution = this.calculateFieldContribution(changedFieldCount);
    if (changedFieldCount > 0) {
      factors.push({
        name: 'changedFieldCount',
        value: changedFieldCount,
        contribution: fieldContribution,
        description: `${changedFieldCount} field(s) changed`,
      });
      totalScore += fieldContribution;
    }

    // Factor 3: Computed field update steps
    if (input.computedImpact) {
      const stepCount = input.computedImpact.updateSteps.length;
      const stepContribution = this.calculateStepContribution(stepCount);
      factors.push({
        name: 'updateStepCount',
        value: stepCount,
        contribution: stepContribution,
        description: `${stepCount} computed field update step(s)`,
      });
      totalScore += stepContribution;

      // Factor 4: Dependency graph edges
      const edgeCount = input.computedImpact.dependencyGraph.edgeCount;
      const edgeContribution = this.calculateEdgeContribution(edgeCount);
      if (edgeCount > 0) {
        factors.push({
          name: 'dependencyEdgeCount',
          value: edgeCount,
          contribution: edgeContribution,
          description: `${edgeCount} field dependency edge(s)`,
        });
        totalScore += edgeContribution;
      }

      // Factor 5: Cross-table propagation
      const tableCount = input.computedImpact.affectedRecordEstimates.length;
      if (tableCount > 1) {
        const crossTableContribution = (tableCount - 1) * 10;
        factors.push({
          name: 'crossTableCount',
          value: tableCount,
          contribution: crossTableContribution,
          description: `Updates propagate to ${tableCount} table(s)`,
        });
        totalScore += crossTableContribution;
      }

      // Factor 6: Total affected records across tables
      const totalAffectedRecords = input.computedImpact.affectedRecordEstimates.reduce(
        (sum, est) => sum + est.estimatedCount,
        0
      );
      if (totalAffectedRecords > recordCount) {
        const propagationContribution = this.calculatePropagationContribution(
          totalAffectedRecords - recordCount
        );
        factors.push({
          name: 'propagatedRecordCount',
          value: totalAffectedRecords - recordCount,
          contribution: propagationContribution,
          description: `${totalAffectedRecords - recordCount} additional record(s) affected by propagation`,
        });
        totalScore += propagationContribution;
      }
    }

    // Normalize score to 0-100
    const normalizedScore = Math.min(100, totalScore);
    const level = this.determineLevel(normalizedScore);
    const recommendations = this.generateRecommendations(input, factors, level);

    return {
      score: normalizedScore,
      level,
      factors,
      recommendations,
    };
  }

  private calculateRecordContribution(count: number): number {
    if (count <= 1) return 1;
    if (count <= 10) return 5;
    if (count <= 100) return 10;
    if (count <= 1000) return 20;
    return 30;
  }

  private calculateFieldContribution(count: number): number {
    if (count <= 1) return 1;
    if (count <= 5) return 3;
    if (count <= 10) return 5;
    return 10;
  }

  private calculateStepContribution(count: number): number {
    if (count === 0) return 0;
    if (count === 1) return 5;
    if (count <= 3) return 10;
    if (count <= 5) return 15;
    if (count <= 10) return 25;
    return 35;
  }

  private calculateEdgeContribution(count: number): number {
    if (count === 0) return 0;
    if (count <= 5) return 3;
    if (count <= 10) return 5;
    if (count <= 20) return 10;
    return 15;
  }

  private calculatePropagationContribution(count: number): number {
    if (count <= 10) return 2;
    if (count <= 100) return 5;
    if (count <= 1000) return 10;
    return 20;
  }

  private determineLevel(score: number): ComplexityLevel {
    if (score <= 5) return 'trivial';
    if (score <= 15) return 'low';
    if (score <= 35) return 'medium';
    if (score <= 60) return 'high';
    return 'very_high';
  }

  private generateRecommendations(
    input: ComplexityInput,
    factors: ComplexityFactor[],
    level: ComplexityLevel
  ): string[] {
    const recommendations: string[] = [];

    if (level === 'high' || level === 'very_high') {
      // Check for large batch operations
      const recordCount = input.commandInfo.recordIds.length;
      if (recordCount > 100) {
        recommendations.push(
          `Consider batching: ${recordCount} records may cause performance issues`
        );
      }

      // Check for complex computed field chains
      if (input.computedImpact) {
        const stepCount = input.computedImpact.updateSteps.length;
        if (stepCount > 5) {
          recommendations.push(
            `Complex computed chain: ${stepCount} update steps may benefit from denormalization`
          );
        }

        // Check for cross-table propagation
        const tableCount = input.computedImpact.affectedRecordEstimates.length;
        if (tableCount > 2) {
          recommendations.push(
            `Cross-table impact: Updates affect ${tableCount} tables, consider async processing`
          );
        }
      }
    }

    return recommendations;
  }
}
