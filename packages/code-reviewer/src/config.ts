import { existsSync } from "node:fs";
import { z } from "zod";

/**
 * Loads `.env` through Node's built-in parser (no dotenv dependency).
 * Node only reads it when asked, and it never overwrites variables that are
 * already set, so real environment variables still win over the file.
 */
function loadEnvFile(): void {
  if (existsSync(".env")) {
    process.loadEnvFile(".env");
  }
}

const envSchema = z.object({
  /** https://openrouter.ai/keys */
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  /** Any id from https://openrouter.ai/models, as `vendor/model`. */
  OPENROUTER_MODEL: z.string().min(1).default("anthropic/claude-sonnet-5"),
  /** Sent as HTTP-Referer / X-OpenRouter-Title for dashboard attribution. */
  OPENROUTER_APP_URL: z.url().optional(),
  OPENROUTER_APP_NAME: z.string().min(1).default("GamingLibrary code-reviewer"),
});

export type Config = z.infer<typeof envSchema>;

/**
 * Reads and validates configuration. Throws with every offending variable
 * listed at once rather than failing one at a time mid-run.
 *
 * Passing an explicit `env` skips the `.env` file entirely: an injected
 * environment is validated exactly as given, with no hidden side effect on
 * the real `process.env`.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env === process.env) loadEnvFile();

  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return parsed.data;
}
