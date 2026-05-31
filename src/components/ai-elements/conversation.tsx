"use client";

import type { HTMLAttributes } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type ConversationProps = HTMLAttributes<HTMLDivElement>;
type ConversationContentProps = HTMLAttributes<HTMLDivElement>;

function Conversation({ className, children, ...props }: ConversationProps) {
  return (
    <ScrollArea className={cn("min-h-0 flex-1", className)} {...props}>
      {children}
    </ScrollArea>
  );
}

function ConversationContent({ className, children, ...props }: ConversationContentProps) {
  return (
    <div className={cn("space-y-4 px-4 py-6", className)} {...props}>
      {children}
    </div>
  );
}

export { Conversation, ConversationContent };
