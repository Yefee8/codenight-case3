import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getSession, homeForRole } from "@/lib/server/auth";

export default async function LoginPage() {
  const user = await getSession();
  if (user) redirect(homeForRole(user.role));
  return <LoginForm />;
}
