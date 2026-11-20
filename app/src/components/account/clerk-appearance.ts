import type { ClerkProvider } from "@clerk/nextjs";
import type { ComponentProps } from "react";

type Appearance = NonNullable<
  ComponentProps<typeof ClerkProvider>["appearance"]
>;

// Clerk sign-in / sign-up pages, modals and profile UI in the app's Stone
// theme (tokens from globals.css). Pass to <ClerkProvider appearance={...}>
// so every Clerk component matches, and to <SignIn>/<SignUp> directly.
export const appearance = {
  variables: {
    colorBackground: "#1c2722",
    colorForeground: "#f2ede4",
    colorMutedForeground: "#a7b0a9",
    colorPrimary: "#e6e0d5",
    colorPrimaryForeground: "#141c18",
    colorInput: "#131c18",
    colorInputForeground: "#f2ede4",
    colorNeutral: "#f2ede4",
    colorDanger: "#ff8a80",
    colorSuccess: "#8bc34a",
    colorRing: "#8bc34a",
    colorModalBackdrop: "rgba(10, 16, 13, 0.8)",
    fontFamily: "var(--font-inter), system-ui, sans-serif",
    borderRadius: "1rem",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "w-full max-w-full border border-white/10 shadow-none",
    card: "bg-card",
    headerTitle: "font-serif text-2xl font-normal",
    formButtonPrimary: "min-h-12 text-base font-semibold",
    socialButtonsBlockButton: "min-h-12",
    formFieldInput: "min-h-12",
    footer: "bg-inset",
  },
} satisfies Appearance;
