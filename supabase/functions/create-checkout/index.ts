// Zik Hunter — opens a Stripe Checkout page for a pack of the shop (Vinyles, welcome offer, Premium pass).
// The price comes from the database (shop_quote, called with the player's own session), never from the page.
// Secrets: STRIPE_SECRET_KEY (and optionally SITE_URL). Deploy with "Verify JWT" off: the player is checked by shop_quote.
const SB = Deno.env.get("SUPABASE_URL")!;
const PUBLIC_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}").default;
const STRIPE = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SITE = Deno.env.get("SITE_URL") ?? "https://theo1guery-cmyk.github.io/sillons/";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!STRIPE) return json({ error: "payments_off" }, 503);
  try {
    const { pack } = await req.json();
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "not_signed_in" }, 401);
    const q = await fetch(`${SB}/rest/v1/rpc/shop_quote`, {
      method: "POST",
      headers: { apikey: PUBLIC_KEY, Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ p_pack: String(pack ?? "") }),
    });
    const quote = await q.json();
    if (!q.ok) return json({ error: quote?.message ?? "quote_failed" }, 400);

    const f = new URLSearchParams({
      mode: "payment",
      locale: "fr",
      success_url: `${SITE}?achat=ok`,
      cancel_url: `${SITE}?achat=annule`,
      client_reference_id: quote.user,
      "metadata[user]": quote.user,
      "metadata[pack]": String(pack),
      "payment_intent_data[metadata][user]": quote.user,
      "payment_intent_data[metadata][pack]": String(pack),
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": String(quote.cents),
      "line_items[0][price_data][product_data][name]": `Zik Hunter · ${quote.name}`,
    });
    if (quote.email) f.set("customer_email", quote.email);
    const s = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${STRIPE}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: f,
    });
    const session = await s.json();
    if (!s.ok) return json({ error: session?.error?.message ?? "stripe_error" }, 502);
    return json({ url: session.url });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
