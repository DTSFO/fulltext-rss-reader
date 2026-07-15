import { clearSession } from "@/features/auth/server/session";
import { apiData, apiError } from "@/lib/http/api-response";

export async function POST() {
  try {
    await clearSession();
    return apiData({ signedOut: true });
  } catch (error) {
    return apiError(error);
  }
}
