// محضر اجتماع — دالة الخادم (Supabase Edge Function) باسم: ai
// الوظائف: صياغة المحضر بالذكاء الاصطناعي + إعادة تعيين كلمة المرور + حذف مستخدم (للمدير)
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { ...cors, "Content-Type": "application/json" } });

const SYSTEM = [
  "أنت أمين سر محترف متخصص في صياغة محاضر الاجتماعات الرسمية باللغة العربية الفصحى.",
  "ستصلك ملاحظات خام عن اجتماع، وعليك تحويلها إلى محضر احترافي منظم.",
  "أعد النتيجة بصيغة JSON فقط دون أي نص خارجها، بالمفاتيح التالية بالضبط:",
  "{",
  ' "title": "عنوان موجز للاجتماع",',
  ' "attendees": [{"name": "اسم الحاضر", "role": "المسمى أو الجهة"}],',
  ' "opening": "فقرة الافتتاحية بصياغة رسمية (من افتتح الاجتماع ومتى والترحيب)",',
  ' "introduction": "فقرة المقدمة: الغرض من الاجتماع وأهم محاور النقاش",',
  ' "previous_review": [{"item": "توصية من الاجتماع السابق", "status": "منجزة | قيد التنفيذ | لم تنفذ | مؤجلة", "notes": "ملاحظات"}],',
  ' "recommendations": ["توصية واضحة ومحددة"],',
  ' "tasks": [{"task": "وصف المهمة", "owner": "اسم الشخص المعني", "due": "YYYY-MM-DD"}]',
  "}",
  "القواعد:",
  "- لا تختلق معلومات أو أسماء أو تواريخ غير موجودة في الملاحظات. إن لم تُذكر معلومة فاترك قيمتها نصاً فارغاً أو قائمة فارغة.",
  "- لكل مهمة شخص معني وتاريخ إنجاز؛ إن ذُكرت مدة نسبية (مثل: خلال أسبوع) فاحسب التاريخ انطلاقاً من تاريخ الاجتماع. إن لم يُذكر المعني أو الموعد فاتركه فارغاً.",
  "- إن زُوّدت بقائمة توصيات الاجتماع السابق فاستخدمها في previous_review وحدد حالة كل منها من الملاحظات.",
  "- صياغة رسمية موجزة ودقيقة.",
].join("\n");

async function callAI(cfg: Record<string, string>, userText: string): Promise<string> {
  const provider = cfg.provider || "gemini";
  const key = cfg.key;
  if (!key) throw new Error("لم يتم ضبط مفتاح الذكاء الاصطناعي. يضبطه مدير النظام من: الإدارة ثم الذكاء الاصطناعي");

  let res: Response;
  let pick: (j: any) => string;
  if (provider === "gemini") {
    const model = cfg.model || "gemini-flash-latest";
    res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
      }),
    });
    pick = (j) => (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
  } else if (provider === "anthropic") {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: cfg.model || "claude-sonnet-4-5",
        max_tokens: 4096,
        system: SYSTEM,
        messages: [{ role: "user", content: userText }],
      }),
    });
    pick = (j) => (j.content ?? []).map((p: any) => p.text ?? "").join("");
  } else {
    const base = (cfg.base || "https://api.openai.com/v1").replace(/\/+$/, "");
    res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model: cfg.model || "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userText }],
      }),
    });
    pick = (j) => j.choices?.[0]?.message?.content ?? "";
  }
  const raw = await res.text();
  if (!res.ok) throw new Error("خطأ من مزود الذكاء الاصطناعي (" + res.status + "): " + raw.slice(0, 300));
  return pick(JSON.parse(raw));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await db.auth.getUser(token);
    if (!auth?.user) return reply({ error: "يجب تسجيل الدخول" });

    const { data: me } = await db.from("profiles").select("id, role, active").eq("id", auth.user.id).single();
    if (!me?.active) return reply({ error: "الحساب غير مفعّل" });
    const isAdmin = me.role === "admin";
    const body = await req.json();

    if (body.action === "generate") {
      const notes = String(body.notes ?? "").trim();
      if (!notes) return reply({ error: "اكتب ملاحظات الاجتماع أولاً" });
      if (notes.length > 40000) return reply({ error: "الملاحظات طويلة جداً" });
      const { data: sec } = await db.from("secrets").select("ai").eq("id", 1).single();
      const ctx = body.context ?? {};
      const userText =
        "تاريخ الاجتماع: " + (ctx.date || "غير محدد") + "\n" +
        "عنوان الاجتماع (إن وجد): " + (ctx.title || "") + "\n" +
        "الحضور المسجلون: " + JSON.stringify(ctx.attendees ?? []) + "\n" +
        "توصيات الاجتماع السابق: " + JSON.stringify(ctx.previous ?? []) + "\n\n" +
        "ملاحظات الاجتماع الخام:\n" + notes;
      const text = await callAI(sec?.ai ?? {}, userText);
      const a = text.indexOf("{"), b = text.lastIndexOf("}");
      if (a < 0 || b < 0) return reply({ error: "تعذر قراءة رد الذكاء الاصطناعي، حاول مرة أخرى" });
      return reply({ result: JSON.parse(text.slice(a, b + 1)) });
    }

    if (body.action === "reset_password") {
      if (!isAdmin) return reply({ error: "هذه العملية لمدير النظام فقط" });
      if (String(body.password ?? "").length < 6) return reply({ error: "كلمة المرور 6 خانات على الأقل" });
      const { error } = await db.auth.admin.updateUserById(body.user_id, { password: body.password });
      return reply(error ? { error: error.message } : { ok: true });
    }

    if (body.action === "delete_user") {
      if (!isAdmin) return reply({ error: "هذه العملية لمدير النظام فقط" });
      if (body.user_id === me.id) return reply({ error: "لا يمكنك حذف حسابك" });
      const { error } = await db.auth.admin.deleteUser(body.user_id);
      return reply(error ? { error: error.message } : { ok: true });
    }

    return reply({ error: "عملية غير معروفة" });
  } catch (e) {
    return reply({ error: (e as Error).message || "خطأ غير متوقع" });
  }
});
