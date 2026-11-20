"use client";

import { type ReactNode, useId } from "react";

// Small shared building blocks for the journey steps (match brand tokens).

export const cardClass =
  "flex flex-col gap-4 rounded-3xl border border-white/10 bg-card p-4";
export const fieldBox =
  "flex flex-col gap-1 rounded-2xl bg-inset p-4 focus-within:ring-2 focus-within:ring-cream/60";
export const fieldLabel = "text-xs tracking-[0.15em] text-muted uppercase";
export const inputClass =
  "min-h-8 w-full bg-transparent text-lg outline-none placeholder:text-white/35";
export const chipClass = (on: boolean) =>
  `min-h-11 rounded-full border px-4 text-sm focus-visible:outline-2 focus-visible:outline-cream ${on ? "border-transparent bg-cream text-ink" : "border-white/15"}`;
export const subtleButton =
  "min-h-11 rounded-2xl bg-white/5 px-4 text-sm text-muted focus-visible:outline-2 focus-visible:outline-cream";
export const dashedButton =
  "min-h-12 rounded-3xl border border-dashed border-white/25 px-4 text-muted focus-visible:outline-2 focus-visible:outline-cream";

export function Section({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section className={cardClass}>
      <div className="flex flex-col gap-1">
        <h2 className="text-xs tracking-[0.2em] text-muted uppercase">
          {title}
        </h2>
        {intro && <p className="text-sm text-muted">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  numeric,
  wide = true,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  numeric?: boolean;
  wide?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className={`${fieldBox} ${wide ? "col-span-2" : ""}`}>
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <input
        id={id}
        className={inputClass}
        value={value}
        placeholder={placeholder}
        inputMode={numeric ? "decimal" : undefined}
        onChange={(e) =>
          onChange(
            numeric ? e.target.value.replace(/[^0-9.]/g, "") : e.target.value,
          )
        }
      />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  wide = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  wide?: boolean;
}) {
  const id = useId();
  return (
    <div className={`${fieldBox} ${wide ? "col-span-2" : ""}`}>
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <select
        id={id}
        className={`${inputClass} min-h-11`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="text-ink">
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Chips<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: { value: T; label: string }[];
  value: T | undefined;
  onChange: (v: T | undefined) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button
              type="button"
              key={o.value}
              aria-pressed={on}
              onClick={() => onChange(on ? undefined : o.value)}
              className={chipClass(on)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl bg-inset p-4 focus-within:ring-2 focus-within:ring-cream/60">
      <input
        type="checkbox"
        className="mt-1 size-5 shrink-0 accent-cream"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex flex-col gap-1">
        <span>{label}</span>
        {hint && <span className="text-sm text-muted">{hint}</span>}
      </span>
    </label>
  );
}

let counter = 0;
export function localId(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}
