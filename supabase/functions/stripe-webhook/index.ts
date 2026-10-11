// Zik Hunter — Stripe tells us a payment went through: deliver the pack (credit_purchase, once per Checkout session).
// Secrets: STRIPE_WEBHOOK_SECRET (the "whsec_…" of the webhook endpoint). Deploy with "Verify JWT" off: Stripe signs
// its calls instead, and the signature is checked here.
const SB = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default;
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const enc = new TextEncoder();

// Stripe-Signature: t=timestamp,v1=hex(HMAC-SHA256(secret, `${t}.${body}`)), within 5 minutes
async function signed(body: string, header: string) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = parts.t, sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${body}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => s.length === hex.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const body = await req.text();
  if (!WEBHOOK_SECRET || !(await signed(body, req.headers.get("stripe-signature") ?? ""))) return new Response("bad signature", { status: 400 });
  const ev = JSON.parse(body);
  if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
    const s = ev.data.object;
    if (s.payment_status === "paid" && s.metadata?.user && s.metadata?.pack) {
      const headers: Record<string, string> = { apikey: SECRET_KEY, "Content-Type": "application/json" };
      if (!SECRET_KEY.startsWith("sb_")) headers.Authorization = `Bearer ${SECRET_KEY}`;   // a legacy service_role JWT
      const r = await fetch(`${SB}/rest/v1/rpc/credit_purchase`, {
        method: "POST", headers,
        body: JSON.stringify({ p_session: s.id, p_user: s.metadata.user, p_pack: s.metadata.pack, p_cents: s.amount_total }),
      });
      if (!r.ok) return new Response(await r.text(), { status: 500 });   // Stripe will try again
    }
  }
  return new Response("ok");
});
