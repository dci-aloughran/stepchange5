import type { Metadata } from "next";
import { AccountView } from "@/components/account/account-view";
import { Brand } from "@/components/brand";

export const metadata: Metadata = {
  title: "Your account · Deloitful.Home",
};

export default function AccountPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pt-8 pb-10">
      <Brand />
      <p className="text-xs tracking-[0.2em] text-muted uppercase">Account</p>
      <h1 className="font-serif text-4xl leading-tight">Your account.</h1>
      <AccountView />
    </main>
  );
}
