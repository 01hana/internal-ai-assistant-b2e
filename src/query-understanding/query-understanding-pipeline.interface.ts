import { QueryUnderstandingInput, QueryUnderstandingOutput } from './query-understanding.types';

export interface QueryUnderstandingPipeline {
  understand(input: QueryUnderstandingInput): Promise<QueryUnderstandingOutput>;
}
