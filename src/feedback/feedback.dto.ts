import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class SubmitFeedbackDto {
  @IsIn(['positive', 'negative', 'neutral'])
  rating!: 'positive' | 'negative' | 'neutral';

  @IsOptional()
  @IsIn(['correction', 'unsafe', 'not_helpful', 'missing_evidence', 'other'])
  intent?: 'correction' | 'unsafe' | 'not_helpful' | 'missing_evidence' | 'other';

  @IsOptional()
  @IsString()
  @MaxLength(160)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class ReviewItemsQueryDto {
  @IsOptional()
  @IsIn(['open', 'in_review', 'resolved', 'dismissed'])
  status?: 'open' | 'in_review' | 'resolved' | 'dismissed';

  @IsOptional()
  @IsIn([
    'failed_query',
    'no_answer',
    'tool_failure',
    'negative_feedback',
    'missing_evidence',
    'bad_tool_routing',
    'permission_mapping_issue'
  ])
  sourceType?:
    | 'failed_query'
    | 'no_answer'
    | 'tool_failure'
    | 'negative_feedback'
    | 'missing_evidence'
    | 'bad_tool_routing'
    | 'permission_mapping_issue';

  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  priority?: 'low' | 'medium' | 'high';
}

export class ReviewItemDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  reason?: string;
}
