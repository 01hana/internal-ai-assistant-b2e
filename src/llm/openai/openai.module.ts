import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OpenAiProvider } from './openai.provider';

@Module({
  imports: [ConfigModule],
  providers: [OpenAiProvider],
  exports: [OpenAiProvider]
})
export class OpenAiModule {}
