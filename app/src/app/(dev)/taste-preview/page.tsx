import { notFound } from "next/navigation";
import { Brand } from "@/components/brand";
import { InspirationStep } from "@/components/taste/inspiration-step";
import { TasteStep } from "@/components/taste/taste-step";

// Development-only preview of the taste components before they are wired
// into the journey's Style and Taste steps.
export default function TastePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pt-8 pb-10">
      <Brand trailing="Dev preview" />
      <header className="flex flex-col gap-3">
        <p className="text-xs tracking-[0.2em] text-muted uppercase">
          03 / Style inspiration
        </p>
        <h1 className="font-serif text-4xl leading-tight">Find the feeling.</h1>
      </header>
      <InspirationStep />
      <header className="flex flex-col gap-3 pt-6">
        <p className="text-xs tracking-[0.2em] text-muted uppercase">
          03 / Your interpreted taste
        </p>
        <h2 className="font-serif text-4xl leading-tight">
          A starting point, not a style label.
        </h2>
      </header>
      <TasteStep />
    </main>
  );
}
