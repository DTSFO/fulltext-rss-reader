import { loginInputSchema } from "@/features/auth/schemas/login-schema";
import { login } from "@/features/auth/server/login";
import { apiData, apiError } from "@/lib/http/api-response";

export async function POST(request: Request) {
  try {
    const input = loginInputSchema.parse(await request.json());
    const user = await login(input);
    return apiData({ user });
  } catch (error) {
    return apiError(error);
  }
}
