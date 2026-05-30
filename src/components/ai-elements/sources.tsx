import type { AnchorHTMLAttributes, HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type SourcesProps = HTMLAttributes<HTMLDivElement>;

type SourceProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  title: string;
  href: string;
};

function Sources({ className, children, ...props }: SourcesProps) {
  return (
    <div
      className={cn("flex flex-wrap gap-2 border-t border-stone-200 pt-3", className)}
      {...props}
    >
      {children}
    </div>
  );
}

function Source({ className, title, href, ...props }: SourceProps) {
  return (
    <a
      className={cn(
        "inline-flex max-w-full items-center rounded-full border border-stone-300 bg-white px-3 py-1 text-xs text-stone-700 underline-offset-4 hover:bg-stone-100 hover:underline",
        className,
      )}
      href={href}
      rel="noreferrer"
      target="_blank"
      title={title}
      {...props}
    >
      <span className="truncate">{title}</span>
    </a>
  );
}

export { Source, Sources };
