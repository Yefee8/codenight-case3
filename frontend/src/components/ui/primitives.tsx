import * as React from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "danger" | "ghost";
  size?: "default" | "sm" | "icon";
  loading?: boolean;
};

export const buttonStyles = ({ variant = "default", size = "default" }: Pick<ButtonProps, "variant" | "size"> = {}) => cn(
  "relative inline-flex items-center justify-center gap-2 rounded-full font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50",
  variant === "default" && "bg-brand-gradient text-white shadow-sm hover:brightness-105",
  variant === "outline" && "border border-border bg-surface hover:bg-muted",
  variant === "danger" && "bg-red-500 text-white hover:bg-red-400",
  variant === "ghost" && "hover:bg-muted",
  size === "default" && "h-10 px-4 py-2",
  size === "sm" && "h-8 px-3 text-xs",
  size === "icon" && "size-10",
);

export function Button({ className, variant, size, loading = false, disabled, children, ...props }: ButtonProps) {
  return <button className={cn(buttonStyles({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
    {loading && <LoaderCircle size={16} className="absolute inset-0 m-auto animate-spin motion-reduce:animate-none" />}
    <span className={cn(loading && "opacity-0")}>{children}</span>
  </button>;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-border bg-surface shadow-[0_12px_35px_-30px_rgba(3,78,162,.55)]", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pb-2", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-base font-semibold tracking-tight", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-3", className)} {...props} />;
}

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex items-center rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold", className)} {...props} />;
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn("h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none placeholder:text-subtle focus:border-accent focus:ring-2 focus:ring-accent/20", className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn("min-h-24 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-subtle focus:border-accent focus:ring-2 focus:ring-accent/20", className)} {...props} />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn("h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-accent", className)} {...props} />
));
Select.displayName = "Select";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-xs font-medium text-muted-foreground", className)} {...props} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-muted", className)} />;
}
