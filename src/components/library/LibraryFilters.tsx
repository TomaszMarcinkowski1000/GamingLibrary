import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_LIBRARY_SORT, LIBRARY_SORTS, PLAY_STATUSES, PLAY_STATUS_LABELS } from "@/types";
import type { LibraryFacets, LibraryFilters as LibraryFiltersValue, LibrarySort } from "@/types";

interface FilterOption {
  value: string;
  label: string;
  count: number;
}

interface LibraryFiltersProps {
  /** The committed title search currently reflected in the URL. */
  search: string;
  /** The committed selected values per dimension. */
  filters: LibraryFiltersValue;
  /** The committed sort key. */
  sort: LibrarySort;
  /** Owned-only filter options with per-value counts from `library_facets()`. */
  facets: LibraryFacets;
}

const SORT_KEYS = Object.keys(LIBRARY_SORTS) as LibrarySort[];

/** Trigger styling shared by the filter popovers, the sort select, and the action buttons,
 * matching the emerald glass control-bar look (the page is always dark). */
const CONTROL_CLASS =
  "inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-400/20 bg-white/10 px-4 text-sm text-white transition-colors hover:bg-white/20";

/**
 * Library browse control bar (S-06).
 *
 * Presentational only — no client-side row filtering. Holds the search box, four multi-select
 * filter popovers (status, platform, genre, series; each option labeled "{value} ({count})"),
 * a sort dropdown, and a clear-all. On Apply it composes a `/library?…` URL from the *pending*
 * local state (repeated `status`/`platform`/`genre`/`series` params + `q` + non-default `sort`,
 * no `page` so it resets to page 1) and performs a full-page GET navigation — keeping 100% of
 * filtering server-side. Selected values combine OR within a dimension, AND across.
 */
export default function LibraryFilters({ search, filters, sort, facets }: LibraryFiltersProps) {
  const [searchTerm, setSearchTerm] = useState(search);
  const [statuses, setStatuses] = useState<string[]>(filters.statuses ?? []);
  const [platforms, setPlatforms] = useState<string[]>(filters.platforms ?? []);
  const [genres, setGenres] = useState<string[]>(filters.genres ?? []);
  const [series, setSeries] = useState<string[]>(filters.series ?? []);
  const [sortKey, setSortKey] = useState<LibrarySort>(sort);

  // Statuses are zero-filled from the five canonical labels so all five always show, even
  // those the user owns none of (count 0). Platform/genre/series come straight from facets,
  // so they only ever offer owned values.
  const statusCounts = new Map(facets.statuses.map((f) => [f.value, f.count]));
  const statusOptions: FilterOption[] = PLAY_STATUSES.map((value) => ({
    value,
    label: PLAY_STATUS_LABELS[value],
    count: statusCounts.get(value) ?? 0,
  }));
  const toOptions = (values: LibraryFacets["platforms"]): FilterOption[] =>
    values.map((f) => ({ value: f.value, label: f.value, count: f.count }));
  const platformOptions = toOptions(facets.platforms);
  const genreOptions = toOptions(facets.genres);
  const seriesOptions = toOptions(facets.series);

  // Whether anything is committed in the URL right now — drives the "Clear all" affordance.
  const committedFiltered =
    search.length > 0 ||
    (filters.statuses?.length ?? 0) > 0 ||
    (filters.platforms?.length ?? 0) > 0 ||
    (filters.genres?.length ?? 0) > 0 ||
    (filters.series?.length ?? 0) > 0 ||
    sort !== DEFAULT_LIBRARY_SORT;

  function apply() {
    const params = new URLSearchParams();
    const term = searchTerm.trim();
    if (term) {
      params.set("q", term);
    }
    for (const value of statuses) {
      params.append("status", value);
    }
    for (const value of platforms) {
      params.append("platform", value);
    }
    for (const value of genres) {
      params.append("genre", value);
    }
    for (const value of series) {
      params.append("series", value);
    }
    if (sortKey !== DEFAULT_LIBRARY_SORT) {
      params.set("sort", sortKey);
    }
    const qs = params.toString();
    window.location.assign(qs ? `/library?${qs}` : "/library");
  }

  function clearAll() {
    window.location.assign("/library");
  }

  return (
    <div className="mb-6 flex flex-col gap-3">
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <input
          type="text"
          value={searchTerm}
          onChange={(event) => {
            setSearchTerm(event.target.value);
          }}
          placeholder="Search by title…"
          aria-label="Search your library by title"
          className="min-w-[12rem] flex-1 rounded-lg border border-emerald-400/20 bg-white/5 px-4 py-2 text-sm text-white backdrop-blur-xl placeholder:text-emerald-100/40 focus:border-emerald-400/40 focus:outline-none"
        />
        <button type="submit" className={CONTROL_CLASS}>
          Apply
        </button>
        {committedFiltered && (
          <button type="button" onClick={clearAll} className={CONTROL_CLASS}>
            Clear all
          </button>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-3">
        <FilterPopover label="Status" options={statusOptions} selected={statuses} onChange={setStatuses} />
        {platformOptions.length > 0 && (
          <FilterPopover
            label="Platform"
            options={platformOptions}
            selected={platforms}
            onChange={setPlatforms}
            searchable
          />
        )}
        {genreOptions.length > 0 && (
          <FilterPopover label="Genre" options={genreOptions} selected={genres} onChange={setGenres} searchable />
        )}
        {seriesOptions.length > 0 && (
          <FilterPopover label="Series" options={seriesOptions} selected={series} onChange={setSeries} searchable />
        )}

        <Select
          value={sortKey}
          onValueChange={(value) => {
            setSortKey(value as LibrarySort);
          }}
        >
          <SelectTrigger
            aria-label="Sort order"
            className={cn(
              CONTROL_CLASS,
              // Override the SelectTrigger primitive's emerald `dark:bg-input/*` so the closed
              // control reads as the same grey-glass as the sibling filter buttons.
              "w-auto border-emerald-400/20 bg-white/10 text-white shadow-none data-[size=default]:h-10 dark:bg-white/10 dark:hover:bg-white/20",
            )}
          >
            <span className="text-emerald-100/60">Sort:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {SORT_KEYS.map((key) => (
              <SelectItem key={key} value={key}>
                {LIBRARY_SORTS[key].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

interface FilterPopoverProps {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Show a search box inside the popover (for longer lists like platforms/genres). */
  searchable?: boolean;
}

/** A single multi-select filter dimension: a labeled trigger that opens a checkbox list of
 * owned values with counts. Toggling keeps the popover open so several values can be picked
 * before the user applies. */
function FilterPopover({ label, options, selected, onChange, searchable }: FilterPopoverProps) {
  const [open, setOpen] = useState(false);

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-expanded={open} className={CONTROL_CLASS}>
          {label}
          {selected.length > 0 && (
            <span className="rounded-full bg-emerald-500/40 px-1.5 text-xs font-medium text-white">
              {selected.length}
            </span>
          )}
          <ChevronDown className="size-4 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command shouldFilter={Boolean(searchable)}>
          {searchable && <CommandInput placeholder={`Search ${label.toLowerCase()}…`} />}
          <CommandList>
            {searchable && <CommandEmpty>No {label.toLowerCase()} found.</CommandEmpty>}
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => {
                    toggle(option.value);
                  }}
                >
                  <span
                    className={cn(
                      "flex size-4 items-center justify-center rounded-sm border",
                      selected.includes(option.value)
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-muted-foreground/40",
                    )}
                  >
                    {selected.includes(option.value) && <Check className="size-3" />}
                  </span>
                  <span className="flex-1">{option.label}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">{option.count}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {selected.length > 0 && (
          // Lives outside <Command> so a search query never filters the clear action away.
          <div className="border-t p-1">
            <button
              type="button"
              onClick={() => {
                onChange([]);
              }}
              className="text-muted-foreground hover:bg-accent hover:text-accent-foreground w-full rounded-sm px-2 py-1.5 text-left text-sm transition-colors"
            >
              Clear {label.toLowerCase()}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
