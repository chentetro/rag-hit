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
    <section className="mx-auto flex h-[calc(100vh-2rem)] w-full max-w-4xl flex-col rounded-3xl border border-stone-200 bg-stone-50 shadow-sm">
      <header className="border-b border-stone-200 px-6 py-4 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-stone-500">
          HIT RAG Assistant
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">
          עוזר אקדמי מבוסס מקורות
        </h1>
        <p className="mt-1 text-sm text-stone-600">
          התשובות נוצרות בעברית אך ורק לפי ההקשר שנמצא במסד הנתונים.
        </p>
      </header>

      <Conversation>
        <ConversationContent>
          {messages.length === 0 ? (
            <div className="mx-auto max-w-xl rounded-2xl border border-dashed border-stone-300 bg-white p-6 text-center text-sm text-stone-600">
              שאל שאלה על מידע שנסרק מאתר HIT. אם המקורות לא מספיקים, המערכת תאמר זאת
              במקום להמציא תשובה.
            </div>
          ) : (
            messages.map((message) => <MessageBubble key={message.id} message={message} />)
          )}
        </ConversationContent>
      </Conversation>

      {error ? (
        <div className="border-t border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
          שגיאה: {error.message}
        </div>
      ) : null}

      <form
        className="flex gap-2 border-t border-stone-200 bg-white p-4"
        dir="rtl"
        onSubmit={handleSubmit}
      >
        <Input
          className="h-11 flex-1 border-stone-300 bg-white text-stone-950 placeholder:text-stone-400 focus-visible:ring-stone-400"
          disabled={isBusy}
          onChange={(event) => setInput(event.target.value)}
          placeholder="כתוב שאלה על HIT..."
          value={input}
        />
        {isBusy ? (
          <Button
            className="h-11 bg-stone-950 px-5 text-white hover:bg-stone-800"
            onClick={() => void stop()}
            type="button"
          >
            עצור
          </Button>
        ) : (
          <Button className="h-11 bg-stone-950 px-5 text-white hover:bg-stone-800" type="submit">
            שלח
          </Button>
        )}
      </form>
    </section>
  );
}
