import type { Ref } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlatformCombobox } from "./PlatformCombobox";

export interface GameFormValues {
  title: string;
  platform: string;
}

interface GameFormFieldsProps {
  values: GameFormValues;
  onChange: (patch: Partial<GameFormValues>) => void;
  errors?: Record<string, string>;
  platformOptions: string[];
  titleRef?: Ref<HTMLInputElement>;
  /** Portal target for the platform popover — forwarded to keep wheel-scroll working in-dialog. */
  platformContainer?: Element | null;
}

/**
 * The Add-game dialog's form *body*, factored out as a standalone, controlled,
 * presentational component (S-01). No fetch, no dialog shell, no submit logic — it just
 * renders fields and reports edits up via `onChange`.
 *
 * The value/onChange/errors shape is intentionally record-based so S-02 can widen it to a
 * full add/edit field set without breaking this contract or the dialog that wraps it. S-01
 * builds only the add fields (title + platform); do NOT add edit-only fields here yet.
 */
export function GameFormFields({
  values,
  onChange,
  errors,
  platformOptions,
  titleRef,
  platformContainer,
}: GameFormFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="game-title">Title</Label>
        <Input
          id="game-title"
          ref={titleRef}
          value={values.title}
          onChange={(event) => {
            onChange({ title: event.target.value });
          }}
          placeholder="e.g. The Legend of Zelda: Breath of the Wild"
          aria-invalid={Boolean(errors?.title)}
        />
        {errors?.title && <p className="text-destructive text-sm">{errors.title}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="game-platform">Platform</Label>
        <PlatformCombobox
          options={platformOptions}
          value={values.platform}
          onChange={(platform) => {
            onChange({ platform });
          }}
          container={platformContainer}
        />
        {errors?.platform && <p className="text-destructive text-sm">{errors.platform}</p>}
      </div>
    </div>
  );
}
