import * as React from "react";
import { cn } from "@/lib/utils";

function Tabs({
  value,
  onValueChange,
  items,
  className,
}: {
  value: string;
  onValueChange: (v: string) => void;
  /** title: la spiegazione che compare passandoci sopra */
  items: { value: string; label: string; title?: string }[];
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("flex gap-1 overflow-x-auto rounded-lg bg-muted p-1", className)}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={item.title}
            onClick={() => onValueChange(item.value)}
            className={cn(
              "h-8 shrink-0 rounded-md px-3 text-[13px] font-medium transition-colors duration-150",
              active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export { Tabs };
