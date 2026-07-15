import { redirect } from "next/navigation";

import { getSessionUser } from "@/features/auth/server/session";

export default async function HomePage() {
  const user = await getSessionUser();
  redirect(user ? "/reader" : "/login");
}
