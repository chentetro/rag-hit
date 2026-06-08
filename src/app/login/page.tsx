import LoginForm from "@/components/LoginForm";

export const metadata = {
  title: "Login | HIT Assistant",
  description: "Sign in to HIT Assistant with GitHub.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return <LoginForm error={error} />;
}
