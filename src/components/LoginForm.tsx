import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { FaGithub } from "react-icons/fa";

import { createClient } from "@/lib/supabase/server";

export default function LoginForm() {
  async function signIn() {
    "use server";

    const supabase = await createClient();
    const origin =
      (await headers()).get("origin") ??
      process.env.NEXT_PUBLIC_SITE_URL ??
      "http://localhost:3000";

    // 1. נגדיר משתנה שיחזיק את הכתובת אליה נרצה להפנות בסוף התהליך
    let redirectUrl: string;

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: {
          redirectTo: `${origin}/auth/callback?next=/`,
        },
      });

      // 2. בדיקה אם חזרה שגיאה מ-Supabase או שלא קיבלנו URL לפנות אליו
      if (error || !data?.url) {
        const errorMsg = error?.message ?? "Login failed to generate OAuth URL";
        redirectUrl = `/login?error=${encodeURIComponent(errorMsg)}`;
      } else {
        // 3. הכל הצליח! נשמור את הכתובת של גיטהאב
        redirectUrl = data.url;
      }
    } catch {
      // הגנה מפני קריסות לא צפויות ברשת
      redirectUrl = `/login?error=${encodeURIComponent("An unexpected error occurred")}`;
    }

    // 4. 🔥 קריטי: ה-redirect חייב לרוץ בסוף הפונקציה, מחוץ לכל בלוק פנימי!
    return redirect(redirectUrl);
  }

  return (
    <form
      action={signIn}
      className="flex min-h-screen flex-1 items-center justify-center bg-slate-950 text-white"
    >
      <button
        className="rounded-xl p-8 transition-colors hover:bg-gray-800"
        type="submit"
      >
        <FaGithub className="mx-auto mb-3 size-24" />
        Sign in with GitHub
      </button>
    </form>
  );
}