// Gymloggen AI coach: turns a user's goals into training programs in the app's own format.
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-sonnet-5-5";
const DAILY_LIMIT = 5;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const ICONS = ["press", "squat", "hinge", "pull", "push", "run", "gen"];

const TOOL = {
  name: "skapa_program",
  description: "Spara de färdiga träningsprogrammen till användarens app.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "1–3 meningar på svenska som förklarar upplägget och varför. Tilltala användaren med du." },
      programs: {
        type: "array",
        minItems: 1,
        maxItems: 7,
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Kort passnamn på svenska, t.ex. 'Ben', 'Överkropp A', 'Helkropp'." },
            days: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, description: "Veckodagar: 0=söndag, 1=måndag … 6=lördag." },
            exercises: {
              type: "array",
              minItems: 1,
              maxItems: 12,
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Övningens namn på svenska (eller etablerat gymnamn som 'RDL')." },
                  type: { type: "string", enum: ["kg", "time", "bw"], description: "kg = vikt, time = minuter, bw = kroppsvikt." },
                  icon: { type: "string", enum: ICONS, description: "press=bänk/press, squat=knäböj/ben, hinge=marklyft/höftfällning, pull=rodd/drag, push=armhävning/kroppsvikt överkropp, run=kondition/uppvärmning, gen=övrigt." },
                  locked: { type: "boolean", description: "true för uppvärmning/nedvarvning som ska vara likadan varje pass." },
                  value: { type: ["number", "null"], description: "Kilo (type kg) eller minuter (type time). null för kg om startvikten är okänd. null för bw." },
                  reps: { type: "integer", minimum: 1, maximum: 50, description: "Reps per set. 1 för type time." },
                  sets: { type: "integer", minimum: 1, maximum: 10 },
                },
                required: ["name", "type", "icon", "locked", "value", "reps", "sets"],
              },
            },
          },
          required: ["name", "days", "exercises"],
        },
      },
    },
    required: ["summary", "programs"],
  },
};

const SYSTEM = `Du är en erfaren, försiktig styrketränare som bygger träningsprogram åt användare av gymappen Gymloggen.
Regler:
- Bygg exakt så många pass per vecka som användaren vill träna, fördelade på de dagar hen föredrar (annars jämnt med vilodagar emellan).
- Anpassa till tid per pass: räkna ca 2–3 min per set inklusive vila, plus uppvärmning.
- Börja varje pass med en låst uppvärmning (type time, locked true), t.ex. 5–8 min på löpband, cykel eller roddmaskin.
- Använd bara övningar som går att göra med den utrustning användaren har.
- Undvik övningar som belastar skador eller övningar hen vill undvika. Välj säkrare alternativ.
- Nybörjare: få, grundläggande övningar, 3 set, 8–12 reps. Vana: mer volym och variation.
- Startvikter: sätt value till null för kg-övningar om användaren inte angett kända lyft. Har hen angett kända lyft, föreslå en försiktig startvikt runt 70–80 % av arbetsvikten, avrundad till 2,5 kg.
- Kroppsviktsövningar: type bw, value null.
- Skriv allt på svenska. Inga medicinska råd; vid skada, föreslå att hen kollar med vårdpersonal i summary.
Svara alltid genom att anropa verktyget skapa_program.`;

function clean(input: any) {
  const programs = (Array.isArray(input?.programs) ? input.programs : []).slice(0, 7).map((p: any) => ({
    name: String(p?.name ?? "Pass").slice(0, 40),
    days: [...new Set((Array.isArray(p?.days) ? p.days : []).map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6))],
    exercises: (Array.isArray(p?.exercises) ? p.exercises : []).slice(0, 12).map((x: any) => {
      const type = ["kg", "time", "bw"].includes(x?.type) ? x.type : "kg";
      const v = Number(x?.value);
      return {
        name: String(x?.name ?? "Övning").slice(0, 60),
        type,
        icon: ICONS.includes(x?.icon) ? x.icon : "gen",
        locked: !!x?.locked,
        value: type === "bw" || !isFinite(v) || x?.value === null ? null : Math.round(v * 4) / 4,
        reps: type === "time" ? 1 : Math.min(50, Math.max(1, Math.round(Number(x?.reps) || 1))),
        sets: Math.min(10, Math.max(1, Math.round(Number(x?.sets) || 1))),
      };
    }),
  })).filter((p: any) => p.exercises.length);
  return { summary: String(input?.summary ?? "").slice(0, 600), programs };
}

const DAYS = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
const s = (v: unknown, n = 400) => String(v ?? "").trim().slice(0, n);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const pub = (() => { try { return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}").default; } catch { return undefined; } })() ?? Deno.env.get("SUPABASE_ANON_KEY")!;
  const secret = (() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default; } catch { return undefined; } })() ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(url, pub, { global: { headers: { Authorization: authHeader } } });
  const { data: u, error: ue } = await userClient.auth.getUser(token);
  if (ue || !u?.user) return json({ error: "Du behöver vara inloggad." }, 401);
  const uid = u.user.id;

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Coachen är inte aktiverad än. Nyckeln till AI-tjänsten saknas." }, 503);

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin.from("coach_usage").select("id", { count: "exact", head: true }).eq("user_id", uid).gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return json({ error: `Du har använt coachen ${DAILY_LIMIT} gånger det senaste dygnet. Försök igen imorgon.`, code: "limit" }, 429);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "Ogiltig förfrågan." }, 400); }
  const a = body?.answers ?? {};
  const prefDays = (Array.isArray(a.days) ? a.days : []).filter((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6);

  let msg = `Mål: ${s(a.goal, 600) || "Ej angivet"}
Pass per vecka: ${Number(a.perWeek) || 3}
Minuter per pass: ${Number(a.minutes) || 60}
Föredragna dagar: ${prefDays.length ? prefDays.map((d: number) => DAYS[d]).join(", ") : "Valfritt"}
Erfarenhet: ${s(a.experience, 60) || "Ej angivet"}
Utrustning: ${s(a.equipment, 200) || "Fullt gym"}
Skador / undvik: ${s(a.injuries) || "Inget"}
Kända lyft: ${s(a.lifts) || "Inga angivna"}`;
  if (body?.previous && s(body?.feedback)) {
    msg += `\n\nDitt förra förslag var:\n${JSON.stringify(clean(body.previous)).slice(0, 6000)}\n\nAnvändarens ändringsönskemål: ${s(body.feedback, 600)}\nGör ett nytt förslag som tar hänsyn till det.`;
  }

  await admin.from("coach_usage").insert({ user_id: uid });

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: msg }],
    }),
  });
  if (!r.ok) {
    console.error("anthropic", r.status, await r.text());
    return json({ error: "Coachen svarade inte. Försök igen om en stund." }, 502);
  }
  const out = await r.json();
  const call = (out?.content ?? []).find((c: any) => c.type === "tool_use");
  const result = clean(call?.input);
  if (!result.programs.length) return json({ error: "Coachen kunde inte göra ett förslag. Försök beskriva målet lite tydligare." }, 502);
  return json({ ...result, remaining: Math.max(0, DAILY_LIMIT - (count ?? 0) - 1) });
});
