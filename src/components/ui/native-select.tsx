import * as React from "react";
import { cn } from "@/lib/utils";

function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "block h-10 w-full min-w-0 appearance-none rounded-md border border-input bg-card bg-[length:12px] bg-[right_10px_center] bg-no-repeat px-3 pr-8 text-sm leading-10 text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50",
        className,
      )}
      style={{
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8" fill="none"><path d="M1 1.5 6 6.5 11 1.5" stroke="%236b6458" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>')}")`,
      }}
      {...props}
    />
  );
}

export { NativeSelect };
