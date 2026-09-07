import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { OpenRouterChatSettings } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import type { Config } from "./config.ts";

export interface CreateModelOptions {
  /**
   * OpenRouter provider routing — endpoint ordering, quantization filters, and
   * the `max_price` cap a CI caller uses as a per-request cost wall. Typed
   * against the provider's own settings so this package never restates a shape
   * OpenRouter owns.
   */
  provider?: OpenRouterChatSettings["provider"];
}

/**
 * Builds an OpenRouter-backed language model from validated config.
 * Kept out of the agent module so the reviewer depends only on the AI SDK's
 * `LanguageModel` interface — the seam an eval harness substitutes at.
 *
 * `options` is separate from `Config` because routing is a per-call decision,
 * not an environment one: the same key and model can be driven with different
 * price caps from different callers.
 */
export function createModel(config: Config, options: CreateModelOptions = {}): LanguageModel {
  const openrouter = createOpenRouter({
    apiKey: config.OPENROUTER_API_KEY,
    appName: config.OPENROUTER_APP_NAME,
    ...(config.OPENROUTER_APP_URL ? { appUrl: config.OPENROUTER_APP_URL } : {}),
  });

  return openrouter(config.OPENROUTER_MODEL, options.provider ? { provider: options.provider } : {});
}
