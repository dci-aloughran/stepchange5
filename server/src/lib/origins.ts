// Production app origin(s) come from APP_ORIGIN (comma-separated). Preview
// deployments of the app project are matched by pattern, and any localhost
// port is allowed while the Clerk development instance is in use.
const PREVIEW_PATTERN =
  /^https:\/\/stepchange5-[a-z0-9-]+-step-change-team-5\.vercel\.app$/;
const LOCALHOST_PATTERN = /^http:\/\/localhost:\d{2,5}$/;

export function allowedOrigins(): string[] {
  const configured = (process.env.APP_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return configured;
}

function usingClerkDevInstance() {
  return process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") ?? false;
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return (
    allowedOrigins().includes(origin) ||
    PREVIEW_PATTERN.test(origin) ||
    (usingClerkDevInstance() && LOCALHOST_PATTERN.test(origin))
  );
}
