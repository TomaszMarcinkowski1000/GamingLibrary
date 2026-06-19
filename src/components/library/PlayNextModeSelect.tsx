import { useState } from "react";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ModeOption {
  value: string;
  label: string;
}

interface PlayNextModeSelectProps {
  options: ModeOption[];
  /** The mode currently reflected in the URL (defaulted server-side). */
  defaultValue: string;
}

/**
 * Themed replacement for the native `<select name="mode">` on play-next. Native option lists
 * keep an OS-controlled (blue) highlight that can't be themed, so this renders the shadcn Select
 * (emerald-token glass) and mirrors the choice into a hidden input named `mode`, so the
 * surrounding GET form submits exactly as before.
 */
export default function PlayNextModeSelect({ options, defaultValue }: PlayNextModeSelectProps) {
  const [value, setValue] = useState(defaultValue);

  return (
    <>
      <input type="hidden" name="mode" value={value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger
          aria-label="Mode"
          className={cn(
            "h-10 w-auto rounded-lg border-emerald-400/20 bg-white/5 px-4 text-sm text-white shadow-none",
            // Override the primitive's emerald `dark:bg-input/*` so it matches the glass form controls.
            "data-[size=default]:h-10 dark:bg-white/5 dark:hover:bg-white/10",
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
