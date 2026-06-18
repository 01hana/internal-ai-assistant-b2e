import { LlmProvider } from './llm-provider.interface';

export const LLM_PROVIDERS = Symbol('LLM_PROVIDERS');
export const SELECTED_LLM_PROVIDER = Symbol('SELECTED_LLM_PROVIDER');

export type LlmProviderCollection = LlmProvider[];
