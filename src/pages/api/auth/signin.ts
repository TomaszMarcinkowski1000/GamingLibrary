import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

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
