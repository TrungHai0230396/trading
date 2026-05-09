"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FOREX_PAIRS } from "@/lib/calc/forex-pairs";
import { POPULAR_CRYPTO } from "@/lib/calc/crypto-symbols";

export type InstrumentOption = {
  symbol: string;
  display: string;
  group?: string;
};

export function InstrumentCombobox({
  market,
  value,
  onChange,
  className,
  placeholder = "Chọn instrument…",
}: {
  market: "FOREX" | "CRYPTO";
  value: string;
  onChange: (symbol: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const options: InstrumentOption[] = React.useMemo(() => {
    if (market === "FOREX") {
      return FOREX_PAIRS.map((p) => ({
        symbol: p.symbol,
        display: p.display,
        group: p.group,
      }));
    }
    return POPULAR_CRYPTO.map((c) => ({
      symbol: c.symbol,
      display: c.display,
      group: "Popular",
    }));
  }, [market]);

  const groups = React.useMemo(() => {
    const map = new Map<string, InstrumentOption[]>();
    for (const o of options) {
      const g = o.group ?? "All";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(o);
    }
    return [...map.entries()];
  }, [options]);

  const trimmedQuery = query.trim().toUpperCase().replace("/", "");
  const customAvailable =
    market === "CRYPTO" &&
    trimmedQuery.length >= 4 &&
    !options.some((o) => o.symbol === trimmedQuery);

  const selected = options.find((o) => o.symbol === value);
  const displayLabel = selected?.display ?? (value || placeholder);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between font-mono text-sm",
              !selected && !value && "text-muted-foreground font-sans",
              className,
            )}
          >
            {displayLabel}
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent className="w-[var(--radix-popover-trigger-width,320px)] p-0">
        <Command>
          <CommandInput
            placeholder={
              market === "CRYPTO"
                ? "Tìm hoặc gõ symbol (vd: BTCUSDT)…"
                : "Tìm cặp forex…"
            }
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>Không tìm thấy.</CommandEmpty>
            {customAvailable ? (
              <CommandGroup heading="Dùng symbol tùy chọn">
                <CommandItem
                  value={`__custom__${trimmedQuery}`}
                  onSelect={() => {
                    onChange(trimmedQuery);
                    setOpen(false);
                  }}
                >
                  <Search className="mr-2 size-4" />
                  Dùng{" "}
                  <span className="ml-1 font-mono">{trimmedQuery}</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            {groups.map(([group, items]) => (
              <CommandGroup key={group} heading={group}>
                {items.map((o) => (
                  <CommandItem
                    key={o.symbol}
                    value={`${o.symbol} ${o.display}`}
                    onSelect={() => {
                      onChange(o.symbol);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 size-4",
                        value === o.symbol ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="font-mono">{o.display}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
