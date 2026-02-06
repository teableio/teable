/**
 * Types for complexity assessment.
 */

/**
 * Complexity level classification.
 */
export type ComplexityLevel = 'trivial' | 'low' | 'medium' | 'high' | 'very_high';

/**
 * A factor contributing to complexity.
 */
export type ComplexityFactor = {
  readonly name: string;
  readonly value: number;
  readonly contribution: number;
  readonly description?: string;
};

/**
 * Complexity assessment result.
 */
export type ComplexityAssessment = {
  readonly score: number;
  readonly level: ComplexityLevel;
  readonly factors: ReadonlyArray<ComplexityFactor>;
  readonly recommendations: ReadonlyArray<string>;
};
