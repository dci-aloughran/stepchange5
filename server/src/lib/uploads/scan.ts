// SE-003 malware scanning hook.
//
// GAP: no anti-malware provider is configured yet, so scanFile() reports
// "not_configured" and the pipeline records that on the upload row. The
// structural validation + CDR steps still run. Set UPLOAD_REQUIRE_AV_SCAN=1 to
// fail closed (reject every upload) until a real scanner is wired in.
//
// To integrate a provider (e.g. a ClamAV service in Vercel Sandbox, or a
// commercial scanning API), implement the call below and map its verdict to
// "clean" | "infected" | "error". The pipeline already rejects on
// "infected"/"error" and audits the outcome.

export type ScanVerdict = "not_configured" | "clean" | "infected" | "error";

export type ScanInput = {
  bytes: Buffer;
  mime: string;
  sha256: string;
};

export type Scanner = (input: ScanInput) => Promise<ScanVerdict>;

const notConfigured: Scanner = async () => "not_configured";

let activeScanner: Scanner = notConfigured;

/** Replace the scanner (used by tests and a future provider integration). */
export function setScanner(scanner: Scanner | null) {
  activeScanner = scanner ?? notConfigured;
}

export async function scanFile(input: ScanInput): Promise<ScanVerdict> {
  try {
    return await activeScanner(input);
  } catch {
    return "error";
  }
}

export function scanRequired(): boolean {
  return process.env.UPLOAD_REQUIRE_AV_SCAN === "1";
}
