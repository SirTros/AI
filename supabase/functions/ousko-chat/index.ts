import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://sirtros.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Použij POST." }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Na serveru zatím není nastavený Claude API klíč (ANTHROPIC_API_KEY)." }, 503);

  try {
    const body = await req.json();
    if (!Array.isArray(body?.messages) || body.messages.length < 1 || body.messages.length > 20) {
      return json({ error: "Neplatná konverzace." }, 400);
    }

    const messages = body.messages.map((m: { role?: string; content?: unknown }) => {
      if (!["user", "assistant"].includes(m?.role ?? "") || typeof m.content !== "string" || !m.content.trim() || m.content.length > 8000) {
        throw new Error("Zpráva má neplatný formát nebo je příliš dlouhá.");
      }
      return { role: m.role, content: m.content };
    });
    if (messages[messages.length - 1].role !== "user") {
      return json({ error: "Poslední zpráva musí být od uživatele." }, 400);
    }

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5-5",
        max_tokens: 1200,
        system: "Jsi Ouško, přátelský malý oranžový lišák a hlasový/chatový společník. Mluv přirozeně česky, mile, stručně a srozumitelně. Neříkej o uživateli nic, co ti sám nesdělil. Když něco nevíš, přiznej to. Nepředstírej, že ovládáš skutečné zařízení nebo že máš přístup k jeho poloze či souborům.",
        messages,
      }),
      signal: AbortSignal.timeout(45000),
    });

    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error("Anthropic request failed:", upstream.status, result?.error?.type ?? "unknown");
      return json({ error: "Claude API požadavek se nepodařil. Zkontroluj API klíč a dostupnost modelu." }, 502);
    }
    const reply = Array.isArray(result.content)
      ? result.content.filter((part: { type?: string }) => part.type === "text").map((part: { text?: string }) => part.text ?? "").join("\n").trim()
      : "";
    if (!reply) return json({ error: "Claude vrátil prázdnou odpověď." }, 502);
    return json({ reply });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Neznámá chyba.";
    return json({ error: message }, 400);
  }
});