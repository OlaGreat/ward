// This file is part of Ward.
// Copyright (C) 2026 Ward contributors
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Check, Copy, Loader2, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

export const cn = (...classes: ClassValue[]): string => twMerge(clsx(classes));

type ButtonVariant = "primary" | "secondary" | "ghost" | "care" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-ward text-white hover:bg-ward-dark shadow-sm",
  secondary: "bg-white text-ink border border-line hover:border-ward/40 hover:bg-ward-soft/40",
  ghost: "text-muted hover:text-ink hover:bg-ink/5",
  care: "bg-care text-white hover:brightness-95 shadow-sm",
  danger: "bg-white text-red-700 border border-red-200 hover:bg-red-50",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-xl font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ward",
        "disabled:cursor-not-allowed disabled:opacity-50",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-2xl border border-line bg-white shadow-card", className)}>{children}</div>;
}

type BadgeTone = "ward" | "care" | "gold" | "neutral" | "chain";

const badgeTones: Record<BadgeTone, string> = {
  ward: "bg-ward-soft text-ward-dark",
  care: "bg-care-soft text-care",
  gold: "bg-gold-soft text-gold",
  neutral: "bg-ink/5 text-muted",
  chain: "bg-chain-soft text-sky-200",
};

export function Badge({
  tone = "neutral",
  icon,
  className,
  children,
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        badgeTones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function Field({
  label,
  hint,
  error,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null }) {
  const id = useId();
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={hint || error ? `${id}-help` : undefined}
        className={cn(
          "h-11 w-full rounded-xl border bg-white px-3.5 text-sm text-ink placeholder:text-muted/60",
          "focus:border-ward focus:outline-none focus:ring-4 focus:ring-ward/10",
          error ? "border-red-300" : "border-line",
        )}
        {...props}
      />
      {(error || hint) && (
        <p id={`${id}-help`} className={cn("text-xs", error ? "text-red-700" : "text-muted")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function ProgressBar({ percent, className }: { percent: number; className?: string }) {
  return (
    <div
      className={cn("h-2.5 w-full overflow-hidden rounded-full bg-ink/8", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-ward to-emerald-500 transition-[width] duration-700 ease-out"
        style={{ width: `${Math.max(percent, percent > 0 ? 2 : 0)}%` }}
      />
    </div>
  );
}

export function Notice({
  tone = "ward",
  title,
  children,
  className,
}: {
  tone?: "ward" | "care" | "gold";
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    ward: "border-ward/20 bg-ward-soft/60 text-ward-dark",
    care: "border-care/25 bg-care-soft text-care",
    gold: "border-gold/25 bg-gold-soft text-gold",
  };
  return (
    <div className={cn("rounded-xl border px-4 py-3 text-sm", tones[tone], className)} role="status">
      {title && <p className="font-semibold">{title}</p>}
      <div className={cn(title && "mt-0.5", "leading-relaxed")}>{children}</div>
    </div>
  );
}

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className={className}
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
    >
      {copied ? <Check className="size-4 text-ward" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied ? "Copied" : label}
    </Button>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    panel.current?.querySelector<HTMLElement>("input, button, [tabindex]")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl",
          wide ? "sm:max-w-3xl" : "sm:max-w-lg",
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-xl font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted hover:bg-ink/5 hover:text-ink"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-white/60 px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-ward-soft p-3 text-ward">{icon}</div>
      <p className="font-display text-lg font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}
