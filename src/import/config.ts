/**
 * Import features stay off until a key is set. Nothing here is a secret;
 * keys are read from the environment at request time and never returned.
 */

export type ProviderName = "openai" | "anthropic";

export type ImportConfig = {
  ai: boolean;
  ask: boolean;
  photo: boolean;
  speech: boolean;
  aiProvider: ProviderName | null;
  visionProvider: ProviderName | null;
  speechProvider: "openai" | null;
  openAiKey: string;
  anthropicKey: string;
  aiModel: string;
  visionModel: string;
  speechModel: string;
  speechBaseUrl: string;
  dailyLimit: number;
  globalDailyCap: number;
  rateLimit: number;
};

function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}

function provider(value: string): ProviderName | "off" | null {
  const name = value.toLowerCase();
  if (name === "openai" || name === "anthropic" || name === "off") return name;
  return null;
}

function positiveInt(value: string, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

export function importConfig(env: NodeJS.ProcessEnv = process.env): ImportConfig {
  const openAiKey = trim(env.IMPORT_OPENAI_API_KEY) || trim(env.OPENAI_API_KEY);
  const anthropicKey = trim(env.IMPORT_ANTHROPIC_API_KEY) || trim(env.ANTHROPIC_API_KEY);
  const aiChoice = provider(trim(env.IMPORT_AI_PROVIDER));
  const visionChoice = provider(trim(env.IMPORT_VISION_PROVIDER));
  const speechChoice = trim(env.IMPORT_SPEECH_PROVIDER).toLowerCase();

  let aiProvider: ProviderName | null = null;
  if (aiChoice === "off") aiProvider = null;
  else if (aiChoice === "openai" && openAiKey) aiProvider = "openai";
  else if (aiChoice === "anthropic" && anthropicKey) aiProvider = "anthropic";
  else if (!aiChoice && openAiKey) aiProvider = "openai";
  else if (!aiChoice && anthropicKey) aiProvider = "anthropic";

  let visionProvider: ProviderName | null = null;
  if (visionChoice === "off") visionProvider = null;
  else if (visionChoice === "openai" && openAiKey) visionProvider = "openai";
  else if (visionChoice === "anthropic" && anthropicKey) visionProvider = "anthropic";
  else if (!visionChoice && openAiKey) visionProvider = "openai";
  else if (!visionChoice && anthropicKey) visionProvider = "anthropic";

  const speechProvider: "openai" | null =
    speechChoice === "off" ? null : speechChoice === "openai" || (!speechChoice && openAiKey) ? (openAiKey ? "openai" : null) : null;

  const aiModel =
    trim(env.IMPORT_AI_MODEL) || (aiProvider === "anthropic" ? "claude-3-5-haiku-latest" : "gpt-4o-mini");
  const visionModel =
    trim(env.IMPORT_VISION_MODEL) || (visionProvider === "anthropic" ? "claude-3-5-haiku-latest" : "gpt-4.1-mini");

  return {
    ai: aiProvider !== null,
    ask: aiProvider !== null,
    photo: visionProvider !== null,
    speech: speechProvider !== null,
    aiProvider,
    visionProvider,
    speechProvider,
    openAiKey,
    anthropicKey,
    aiModel,
    visionModel,
    speechModel: trim(env.IMPORT_SPEECH_MODEL) || "whisper-1",
    speechBaseUrl: (trim(env.IMPORT_SPEECH_BASE_URL) || "https://api.openai.com/v1").replace(/\/$/, ""),
    dailyLimit: positiveInt(trim(env.IMPORT_DAILY_LIMIT), 30),
    globalDailyCap: positiveInt(trim(env.IMPORT_GLOBAL_DAILY_CAP), 400),
    rateLimit: positiveInt(trim(env.IMPORT_RATE_LIMIT), 30),
  };
}
