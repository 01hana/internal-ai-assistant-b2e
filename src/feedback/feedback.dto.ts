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
