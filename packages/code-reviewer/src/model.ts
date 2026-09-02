import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import type { Config } from "./config.ts";

/**
 * Builds an OpenRouter-backed language model from validated config.
 * Kept out of the agent module so the reviewer depends only on the AI SDK's
 * `LanguageModel` interface — the seam an eval harness substitutes at.
 */
export function createModel(config: Config): LanguageModel {
  const openrouter = createOpenRouter({
    apiKey: config.OPENROUTER_API_KEY,
    appName: config.OPENROUTER_APP_NAME,
    ...(config.OPENROUTER_APP_URL ? { appUrl: config.OPENROUTER_APP_URL } : {}),
  });

  return openrouter(config.OPENROUTER_MODEL);
}
