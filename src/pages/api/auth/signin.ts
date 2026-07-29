import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { logWarning } from "@/lib/logger";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const POST: APIRoute = async (context) => {
  let email: string, password: string;
  try {
    const form = await context.request.formData();
    ({ email, password } = credentialsSchema.parse({
      email: form.get("email"),
      password: form.get("password"),
    }));
  } catch {
    // A malformed body and a badly-shaped email are different faults, and neither is the "wrong
    // password" this message implies — but the message stays deliberately vague, since a sign-in
    // form must not confirm which half the caller got right. Recorded (without the error object,
    // which can carry the submitted values) so a broken client isn't invisible behind that vagueness.
    logWarning("auth.signin.malformed_request");
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Invalid email or password")}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect("/library");
};
