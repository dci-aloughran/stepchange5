import { notFound } from "next/navigation";
import { Journey } from "@/components/journey";
import { STEPS } from "@/components/steps";

export function generateStaticParams() {
  return STEPS.map((s) => ({ step: s.slug }));
}

export default async function StepPage({
  params,
}: PageProps<"/journey/[step]">) {
  const { step } = await params;
  if (!STEPS.some((s) => s.slug === step)) notFound();
  return <Journey slug={step} />;
}
