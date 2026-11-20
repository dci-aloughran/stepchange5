// Models are routed through Vercel AI Gateway (OIDC auth on Vercel,
// VERCEL_OIDC_TOKEN locally via `vercel env pull`).
export const MODELS = {
  reasoning: process.env.AI_REASONING_MODEL ?? "anthropic/claude-sonnet-5.5",
  vision: process.env.AI_VISION_MODEL ?? "anthropic/claude-sonnet-5.5",
  image: process.env.AI_IMAGE_MODEL ?? "google/gemini-3-pro-image",
} as const;
