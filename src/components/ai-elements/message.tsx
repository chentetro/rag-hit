"use client";

import type { HTMLAttributes } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

type MessageBranchProps = HTMLAttributes<HTMLDivElement>;
type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>;
type MessageContentProps = HTMLAttributes<HTMLDivElement> & {
  from?: "user" | "assistant" | "system";
};
type MessageResponseProps = {
  children: string;
  className?: string;
};

function MessageBranch({ className, children, ...props }: MessageBranchProps) {
  return (
    <div className={cn("w-full", className)} {...props}>
      {children}
    </div>
  );
}

function MessageBranchContent({ className, children, ...props }: MessageBranchContentProps) {
  return (
    <div className={cn("flex w-full flex-col gap-2", className)} {...props}>
      {children}
    </div>
  );
}

function MessageContent({
  className,
  children,
  from = "assistant",
  ...props
}: MessageContentProps) {
  const isUser = from === "user";

  return (
    <article className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl border px-4 py-3 text-sm leading-7 shadow-sm",
          isUser
            ? "border-sky-700 bg-sky-600 text-white shadow-sky-100"
            : "border-sky-100 bg-white text-slate-950 shadow-sky-100/70",
          className,
        )}
        dir="rtl"
        {...props}
      >
        {children}
      </div>
    </article>
  );
}

function MessageResponse({ children, className }: MessageResponseProps) {
  if (!children) {
    return <p className="text-sky-700">מחפש תשובה במאגר המידע...</p>;
  }

  return (
    <div className={cn("prose-chat max-w-none", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

export { MessageBranch, MessageBranchContent, MessageContent, MessageResponse };
