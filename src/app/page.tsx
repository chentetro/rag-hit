import type { Metadata } from "next";
import { ChatInterface } from "@/components/ChatInterface";

export const metadata: Metadata = {
  title: "HIT Assistant | RAG Chatbot",
  description:
    "Hebrew AI assistant for HIT students that answers using verified context from the college website.",
  openGraph: {
    title: "HIT Assistant | RAG Chatbot",
    description:
      "Ask questions in Hebrew and get answers grounded in HIT college website sources.",
    type: "website",
  },
};

export default function Home() {
  return (
    <main className="min-h-screen bg-stone-100 p-4 text-stone-950">
      <ChatInterface />
    </main>
  );
}
