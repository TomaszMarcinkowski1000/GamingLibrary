import { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

interface PlatformComboboxProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  /**
   * Portal target for the popover. When the combobox lives inside a Dialog, pass the
   * dialog content element so the popover renders *inside* the dialog's scroll-lock
   * subtree — otherwise `react-remove-scroll` swallows mouse-wheel scrolling in the list.
   */
  container?: Element | null;
}

/**
 * Creatable platform picker (S-01).
 *
 * Renders the passed `options`; when the typed query matches no option, offers a
 * `Create "<query>"` action that selects the free-text value (e.g. "Evercade"). Matching
 * and the create-vs-exists decision are case-insensitive. Appending a freshly-created
 * value back into the reusable option list is owned by the parent (it holds the options
 * state and feeds them back through props).
 */
export function PlatformCombobox({ options, value, onChange, container }: PlatformComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const trimmed = query.trim();
  const normalized = trimmed.toLowerCase();
  const filtered = normalized ? options.filter((option) => option.toLowerCase().includes(normalized)) : options;
  const canCreate = trimmed.length > 0 && !options.some((option) => option.toLowerCase() === normalized);

  function select(next: string) {
    onChange(next);
    setQuery("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          onKeyDown={(event) => {
            // Tab lands on this trigger (a button, not a text field). Let a printable
            // keystroke open the popover and seed the filter, so "Tab then type" just works
            // without a click. Enter/Space keep their native open-toggle behavior.
            if (open || event.key === " " || event.key.length !== 1) {
              return;
            }
            if (event.ctrlKey || event.metaKey || event.altKey) {
              return;
            }
            setQuery(event.key);
            setOpen(true);
            event.preventDefault();
          }}
        >
          <span className={cn(!value && "text-muted-foreground")}>{value || "Select or type a platform…"}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start" container={container}>
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search or type a platform…" value={query} onValueChange={setQuery} />
          <CommandList>
            {filtered.length > 0 && (
              <CommandGroup>
                {filtered.map((option) => (
                  <CommandItem
                    key={option}
                    value={option}
                    onSelect={() => {
                      select(option);
                    }}
                  >
                    <Check
                      className={cn("mr-2", value.toLowerCase() === option.toLowerCase() ? "opacity-100" : "opacity-0")}
                    />
                    {option}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {canCreate && (
              <CommandGroup>
                <CommandItem
                  value={`create:${trimmed}`}
                  onSelect={() => {
                    select(trimmed);
                  }}
                >
                  <Plus className="mr-2" />
                  Create “{trimmed}”
                </CommandItem>
              </CommandGroup>
            )}
            {filtered.length === 0 && !canCreate && (
              <div className="text-muted-foreground py-6 text-center text-sm">No platforms yet.</div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
