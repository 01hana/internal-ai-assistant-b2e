// Runs before every test file. Runtime feature flags must not leak from a developer's
// .env into tests: Nest ConfigModule and dotenv only fill variables that are unset, so
// defaulting them here keeps results independent of local .env. Tests that need LLM tool
// selection opt in explicitly (and .env.test may still override with override: true).
process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED ??= 'false';
