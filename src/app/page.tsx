import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
  // פונקציה אסינכרונית לבדיקת ה-Auth ישירות בתוך Server Component
  const checkAuthAndRender = async () => {
    const supabase = await createClient();

    // שליפת המשתמש המחובר הנוכחי מתוך הקוקיז המאובטחים
    const { data: { user } } = await supabase.auth.getUser();

    // 🔒 הגנה: אם המשתמש לא מחובר, הקפץ אותו מיד לדף הלוגין
    if (!user) {
      return redirect("/login");
    }

    // ✅ אם הוא מחובר, הצג לו את ממשק הצ'אט הראשי של ה-RAG
    return (
      <main className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-blue-100 p-4 text-slate-950">
        <ChatInterface />
      </main>
    );
  };

  return checkAuthAndRender();
}
