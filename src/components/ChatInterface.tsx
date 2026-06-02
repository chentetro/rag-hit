"use client";

import { FormEvent, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";

import { Conversation, ConversationContent } from "@/components/ai-elements/conversation";
import {
  MessageBranch,
  MessageBranchContent,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Source, Sources } from "@/components/ai-elements/sources";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SourcePart = {
  type: "source-url";
  sourceId: string;
  url: string;
  title?: string;
};

type SourceMetadata = {
  sourceId: string;
  url: string;
  title?: string;
};

function getMetadataSources(message: UIMessage): SourcePart[] {
  const metadata = message.metadata;
  if (
    !metadata ||
    typeof metadata !== "object" ||
    !("sources" in metadata) ||
    !Array.isArray(metadata.sources)
  ) {
    return [];
  }

  return metadata.sources
    .filter((source): source is SourceMetadata => {
      return (
        Boolean(source) &&
        typeof source === "object" &&
        typeof source.sourceId === "string" &&
        typeof source.url === "string"
      );
    })
    .map((source) => ({
      type: "source-url",
      sourceId: source.sourceId,
      url: source.url,
      title: source.title,
    }));
}

function getText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function getSources(message: UIMessage): SourcePart[] {
  return [
    ...message.parts.filter((part): part is SourcePart => part.type === "source-url"),
    ...getMetadataSources(message),
  ];
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = getText(message);
  const sources = getSources(message);

  return (
    <MessageBranch>
      <MessageBranchContent>
        <MessageContent from={isUser ? "user" : "assistant"}>
          <MessageResponse className={isUser ? "text-white! [&_*]:text-white!" : undefined}>
            {text}
          </MessageResponse>

          {!isUser && sources.length > 0 ? (
            <Sources className="mt-4">
              {sources.map((source) => (
                <Source
                  href={source.url}
                  key={`${source.sourceId}-${source.url}`}
                  title={source.title || source.url}
                />
              ))}
            </Sources>
          ) : null}
        </MessageContent>
      </MessageBranchContent>
    </MessageBranch>
  );
}

export function ChatInterface() {
  const [input, setInput] = useState("");
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  const { messages, sendMessage, status, error, stop } = useChat({ transport });
  const isBusy = status === "submitted" || status === "streaming";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || isBusy) return;

    setInput("");
    try {
      await sendMessage({ text });
    } catch (sendError) {
      console.error("Failed to send chat message:", sendError);
      setInput(text);
    }
  }

  return (
    <section className="mx-auto flex h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-sky-200 bg-white shadow-xl shadow-sky-100/70">
      <header className="border-b border-sky-200 bg-gradient-to-r from-sky-600 to-blue-700 px-6 py-5 text-center text-white">
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-sky-100">
          HIT RAG Assistant
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
          עוזר אקדמי מבוסס מקורות
        </h1>
      
      </header>

      <Conversation>
        <ConversationContent>
          {messages.length === 0 ? (
            <div className="mx-auto max-w-xl rounded-2xl border border-dashed border-sky-300 bg-sky-50 p-6 text-center text-sm text-sky-900">
              שאל שאלה על מידע שנסרק מאתר HIT
            </div>
          ) : (
            messages.map((message) => <MessageBubble key={message.id} message={message} />)
          )}
        </ConversationContent>
      </Conversation>

      {error ? (
        <div className="border-t border-sky-200 bg-white px-4 py-3 text-sm text-sky-900">
          שגיאה: {error.message}
        </div>
      ) : null}

      <form
        className="flex gap-2 border-t border-sky-200 bg-white p-4"
        dir="rtl"
        onSubmit={handleSubmit}
      >
        <Input
          className="h-11 flex-1 border-sky-200 bg-white text-slate-950 placeholder:text-sky-400 focus-visible:border-sky-500 focus-visible:ring-sky-200"
          disabled={isBusy}
          onChange={(event) => setInput(event.target.value)}
          placeholder="כתוב שאלה על HIT..."
          value={input}
        />
        {isBusy ? (
          <Button
            className="h-11 bg-sky-600 px-5 text-white hover:bg-sky-700"
            onClick={() => void stop()}
            type="button"
          >
            עצור
          </Button>
        ) : (
          <Button className="h-11 bg-sky-600 px-5 text-white hover:bg-sky-700" type="submit">
            שלח
          </Button>
        )}
      </form>
    </section>
  );
}
