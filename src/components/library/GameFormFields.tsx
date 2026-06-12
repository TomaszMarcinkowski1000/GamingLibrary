import type { Ref } from "react";
import { RefreshCw } from "lucide-react";
import type { MetadataStatus, PlayStatus } from "@/types";
import { PLAY_STATUSES, PLAY_STATUS_LABELS } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlatformCombobox } from "./PlatformCombobox";
import { TagInput } from "./TagInput";

/**
 * Full editable field set for a library entry. Add mode renders only `title`/`platform`;
 * edit mode renders the rest. `igdb_id`/`metadata_status` are carried but never rendered —
 * they're enrichment-owned and mutated only by a successful re-fetch.
 */
export interface GameFormValues {
  title: string;
  platform: string;
  play_status: PlayStatus;
  play_time_hours: number | null;
  date_bought: string | null;
  genre: string[];
  developer: string[];
  series: string[];
  length_hours: number | null;
  release_year: number | null;
  release_date: string | null;
  igdb_id: number | null;
  metadata_status: MetadataStatus | null;
}

interface GameFormFieldsProps {
  values: GameFormValues;
  onChange: (patch: Partial<GameFormValues>) => void;
  errors?: Record<string, string>;
  platformOptions: string[];
  titleRef?: Ref<HTMLInputElement>;
  /** Portal target for the platform popover — forwarded to keep wheel-scroll working in-dialog. */
  platformContainer?: Element | null;
  /** `add` renders Title + Platform only (S-01 layout); `edit` renders the full set. */
  mode?: "add" | "edit";
  /** Edit-mode re-fetch handler (the dialog owns the network call). */
  onRefetch?: () => void;
  /** Re-fetch is in flight. */
  refetchPending?: boolean;
  /** The last re-fetch returned no match — show inline, leave typed values intact. */
  refetchNoMatch?: boolean;
}

/** Parse a numeric `<input>` value, treating empty/invalid as `null`. */
function toNumberOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * The game dialog's form *body*, controlled and presentational (no fetch, no dialog shell).
 * It renders fields and reports edits up via `onChange`. S-01 shipped add-only (title +
 * platform); S-02 widens it to the full add/edit set behind `mode`, keeping the record-based
 * value/onChange/errors contract intact so the add flow renders byte-for-byte as before.
 */
export function GameFormFields({
  values,
  onChange,
  errors,
  platformOptions,
  titleRef,
  platformContainer,
  mode = "add",
  onRefetch,
  refetchPending,
  refetchNoMatch,
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

      {mode === "edit" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="game-play-status">Play status</Label>
            <Select
              value={values.play_status}
              onValueChange={(next) => {
                onChange({ play_status: next as PlayStatus });
              }}
            >
              <SelectTrigger id="game-play-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {PLAY_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {PLAY_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="game-play-time">Play time (hours)</Label>
              <Input
                id="game-play-time"
                type="number"
                min={0}
                value={values.play_time_hours ?? ""}
                onChange={(event) => {
                  onChange({ play_time_hours: toNumberOrNull(event.target.value) });
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="game-date-bought">Date bought</Label>
              <Input
                id="game-date-bought"
                type="date"
                value={values.date_bought ?? ""}
                onChange={(event) => {
                  onChange({ date_bought: event.target.value || null });
                }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="game-genre">Genre</Label>
            <TagInput
              id="game-genre"
              value={values.genre}
              onChange={(genre) => {
                onChange({ genre });
              }}
              placeholder="Add a genre…"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="game-developer">Developer</Label>
            <TagInput
              id="game-developer"
              value={values.developer}
              onChange={(developer) => {
                onChange({ developer });
              }}
              placeholder="Add a developer…"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="game-series">Series</Label>
            <TagInput
              id="game-series"
              value={values.series}
              onChange={(series) => {
                onChange({ series });
              }}
              placeholder="Add a series…"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="game-length">Length (hours)</Label>
              <Input
                id="game-length"
                type="number"
                min={0}
                value={values.length_hours ?? ""}
                onChange={(event) => {
                  onChange({ length_hours: toNumberOrNull(event.target.value) });
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="game-release-year">Release year</Label>
              <Input
                id="game-release-year"
                type="number"
                value={values.release_year ?? ""}
                onChange={(event) => {
                  onChange({ release_year: toNumberOrNull(event.target.value) });
                }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="game-release-date">Release date</Label>
            <Input
              id="game-release-date"
              type="date"
              value={values.release_date ?? ""}
              onChange={(event) => {
                onChange({ release_date: event.target.value || null });
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Button type="button" variant="outline" size="sm" onClick={onRefetch} disabled={refetchPending}>
              <RefreshCw className={refetchPending ? "animate-spin" : undefined} />
              {refetchPending ? "Re-fetching…" : "Re-fetch metadata"}
            </Button>
            {refetchNoMatch && <p className="text-muted-foreground text-sm">No match found — your values were kept.</p>}
          </div>
        </>
      )}
    </div>
  );
}
