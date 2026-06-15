import { Module } from '@nestjs/common';
import { OpenAiProvider } from './openai.provider';

@Module({
  providers: [OpenAiProvider],
  exports: [OpenAiProvider]
})
export class OpenAiModule {}
