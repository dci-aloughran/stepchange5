// Production app origin(s) come from APP_ORIGIN (comma-separated). Preview
// deployments of the app project are matched by pattern.
const PREVIEW_PATTERN =
  /^https:\/\/stepchange5-[a-z0-9-]+-step-change-team-5\.vercel\.app$/;

export function allowedOrigins(): string[] {
  const configured = (process.env.APP_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return configured;
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return allowedOrigins().includes(origin) || PREVIEW_PATTERN.test(origin);
}
