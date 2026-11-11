/** Application-facing provider configuration contains no Pi types. */
export const MODEL_PROVIDERS = {
  deepseek: {
    name: "DeepSeek",
    apiKeyEnvironmentVariable: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-flash",
  },
  anthropic: {
    name: "Anthropic",
    apiKeyEnvironmentVariable: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-6",
  },
} as const;

export type ModelProvider = keyof typeof MODEL_PROVIDERS;
