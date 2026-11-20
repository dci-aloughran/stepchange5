import { SignIn } from "@clerk/nextjs";
import { appearance } from "@/components/account/clerk-appearance";
import { Brand } from "@/components/brand";

export default function Page() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-8 px-5 pt-8 pb-6">
      <Brand />
      <div className="flex justify-center">
        <SignIn appearance={appearance} />
      </div>
    </main>
  );
}
