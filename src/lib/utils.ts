/** Minimal className joiner used by copied UI components (shadcn convention). */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
