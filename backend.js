// طبقة البيانات: وضع Supabase (الإنتاج) أو الوضع التجريبي المحلي (localStorage)
(function () {
  const cfg = window.APP_CONFIG || {};
  const LIVE = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  const fail = (m) => { throw new Error(m); };

  const AUTH_ERRORS = [
    [/invalid login credentials/i, "الرقم الوظيفي أو كلمة المرور غير صحيحة"],
    [/already registered|already been registered/i, "البريد الإلكتروني مسجل مسبقاً"],
    [/password should be at least/i, "كلمة المرور قصيرة (6 خانات على الأقل)"],
    [/email.*invalid|invalid.*email/i, "البريد الإلكتروني غير صالح"],
    [/database error saving new user/i, "تعذر إنشاء المستخدم: تأكد أن الرقم الوظيفي غير مكرر"],
    [/rate limit/i, "محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة"],
    [/failed to fetch|networkerror/i, "تعذر الاتصال بالخادم، تحقق من الإنترنت"],
    [/email not confirmed/i, "البريد الإلكتروني غير مؤكد"],
  ];
  const tr = (e) => {
    const m = (e && e.message) || String(e);
    for (const [re, ar] of AUTH_ERRORS) if (re.test(m)) return new Error(ar);
    return new Error(m);
  };

  // ------------------------------------------------------------------ Supabase
  function live() {
    const opts = { auth: { persistSession: true, autoRefreshToken: true } };
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, opts);
    const ok = ({ data, error }) => { if (error) throw tr(error); return data; };
    const fn = async (body) => {
      const { data, error } = await sb.functions.invoke("ai", { body });
      if (error) throw new Error("تعذر الاتصال بدالة الخادم (ai). تأكد من نشرها حسب دليل الإعداد.");
      if (data && data.error) throw new Error(data.error);
      return data;
    };
    const myProfile = async () => {
      const { data: s } = await sb.auth.getSession();
      if (!s.session) return null;
      const { data } = await sb.from("profiles").select("*").eq("id", s.session.user.id).maybeSingle();
      return data;
    };
    const signUp = (client, u) => client.auth.signUp({
      email: u.email.trim(), password: u.password,
      options: { data: { employee_no: u.employee_no.trim(), name: u.name.trim(), phone: u.phone.trim() } },
    });
    const empFree = async (emp) => {
      if (ok(await sb.rpc("login_email", { emp }))) fail("الرقم الوظيفي مسجل مسبقاً");
    };
    const row = (r) => ({ id: r.id, owner: r.owner, updated_at: r.updated_at, ...r.data, title: r.title, date: r.meeting_date || "" });

    return {
      mode: "live",
      async getSettings() { return ok(await sb.from("settings").select("data").eq("id", 1).maybeSingle())?.data || {}; },
      async saveSettings(data) { ok(await sb.from("settings").update({ data }).eq("id", 1)); },
      session: myProfile,
      async login(emp, password) {
        const email = ok(await sb.rpc("login_email", { emp }));
        if (!email) fail("الرقم الوظيفي أو كلمة المرور غير صحيحة");
        ok(await sb.auth.signInWithPassword({ email, password }));
        const p = await myProfile();
        if (!p || !p.active) { await sb.auth.signOut(); fail("الحساب موقوف، راجع مدير النظام"); }
        return p;
      },
      async register(u) {
        await empFree(u.employee_no);
        const d = ok(await signUp(sb, u));
        if (!d.session) fail("تم إنشاء الحساب. يلزم تأكيد البريد الإلكتروني قبل الدخول (أو يعطّل مدير النظام خيار Confirm email في Supabase).");
        return myProfile();
      },
      async logout() { await sb.auth.signOut(); },
      async updateProfile(p) { ok(await sb.rpc("update_my_profile", { p_name: p.name, p_phone: p.phone })); },
      async changePassword(password) { ok(await sb.auth.updateUser({ password })); },

      async listUsers() { return ok(await sb.from("profiles").select("*").order("created_at")); },
      async adminCreateUser(u) {
        await empFree(u.employee_no);
        // عميل مؤقت حتى لا تتأثر جلسة المدير الحالية
        const tmp = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY,
          { auth: { persistSession: false, autoRefreshToken: false, storageKey: "tmp-signup" } });
        const d = ok(await signUp(tmp, u));
        if (u.role === "admin" && d.user) ok(await sb.from("profiles").update({ role: "admin" }).eq("id", d.user.id));
      },
      async adminUpdateUser(id, patch) { ok(await sb.from("profiles").update(patch).eq("id", id)); },
      async adminResetPassword(id, password) { await fn({ action: "reset_password", user_id: id, password }); },
      async adminDeleteUser(id) { await fn({ action: "delete_user", user_id: id }); },

      async listMinutes() {
        const rows = ok(await sb.from("minutes").select("*, profiles(name)").order("meeting_date", { ascending: false }).order("created_at", { ascending: false }));
        return rows.map((r) => ({ ...row(r), owner_name: r.profiles?.name || "" }));
      },
      async saveMinute(m) {
        const { id, owner, updated_at, owner_name, ...data } = m;
        const rec = { title: m.title || "", meeting_date: m.date || null, data };
        const r = id
          ? ok(await sb.from("minutes").update(rec).eq("id", id).select().single())
          : ok(await sb.from("minutes").insert(rec).select().single());
        return row(r);
      },
      async deleteMinute(id) { ok(await sb.from("minutes").delete().eq("id", id)); },

      async getAI() { return ok(await sb.from("secrets").select("ai").eq("id", 1).maybeSingle())?.ai || {}; },
      async saveAI(ai) { ok(await sb.from("secrets").update({ ai }).eq("id", 1)); },
      async generate(notes, context) { return (await fn({ action: "generate", notes, context })).result; },
    };
  }

  // ------------------------------------------------------------------ تجريبي
  function demo() {
    const get = (k, d) => { try { return JSON.parse(localStorage.getItem("mm_" + k)) ?? d; } catch { return d; } };
    const set = (k, v) => localStorage.setItem("mm_" + k, JSON.stringify(v));
    const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    const hash = async (s) => {
      if (!crypto.subtle) return "p:" + s;
      const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("mm|" + s));
      return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
    };
    const pub = ({ pw, ...u }) => u;
    const me = () => get("users", []).find((u) => u.id === get("sid", null));
    const needAdmin = () => { const u = me(); if (!u || u.role !== "admin") fail("هذه العملية لمدير النظام فقط"); };
    const addUser = async (u, role) => {
      const users = get("users", []);
      if (users.some((x) => x.employee_no === u.employee_no.trim())) fail("الرقم الوظيفي مسجل مسبقاً");
      if (users.some((x) => x.email.toLowerCase() === u.email.trim().toLowerCase())) fail("البريد الإلكتروني مسجل مسبقاً");
      const n = {
        id: uid(), employee_no: u.employee_no.trim(), name: u.name.trim(), email: u.email.trim(), phone: u.phone.trim(),
        role: users.some((x) => x.role === "admin") ? role || "user" : "admin",
        active: true, created_at: new Date().toISOString(), pw: await hash(u.password),
      };
      set("users", [...users, n]);
      return n;
    };
    const patchUser = (id, patch) => set("users", get("users", []).map((u) => (u.id === id ? { ...u, ...patch } : u)));

    return {
      mode: "demo",
      async getSettings() { return get("settings", {}); },
      async saveSettings(d) { needAdmin(); set("settings", d); },
      async session() { const u = me(); return u && u.active ? pub(u) : null; },
      async login(emp, password) {
        const u = get("users", []).find((x) => x.employee_no === emp.trim());
        if (!u || u.pw !== (await hash(password))) fail("الرقم الوظيفي أو كلمة المرور غير صحيحة");
        if (!u.active) fail("الحساب موقوف، راجع مدير النظام");
        set("sid", u.id);
        return pub(u);
      },
      async register(u) { const n = await addUser(u); set("sid", n.id); return pub(n); },
      async logout() { localStorage.removeItem("mm_sid"); },
      async updateProfile(p) { patchUser(me().id, { name: p.name, phone: p.phone }); },
      async changePassword(pw) { patchUser(me().id, { pw: await hash(pw) }); },

      async listUsers() { needAdmin(); return get("users", []).map(pub); },
      async adminCreateUser(u) { needAdmin(); await addUser(u, u.role); },
      async adminUpdateUser(id, patch) { needAdmin(); patchUser(id, patch); },
      async adminResetPassword(id, pw) { needAdmin(); patchUser(id, { pw: await hash(pw) }); },
      async adminDeleteUser(id) {
        needAdmin();
        set("users", get("users", []).filter((u) => u.id !== id));
        set("minutes", get("minutes", []).filter((m) => m.owner !== id));
      },

      async listMinutes() {
        const u = me(), users = get("users", []);
        return get("minutes", [])
          .filter((m) => u.role === "admin" || m.owner === u.id)
          .map((m) => ({ ...m, owner_name: users.find((x) => x.id === m.owner)?.name || "" }))
          .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.updated_at || "").localeCompare(a.updated_at || ""));
      },
      async saveMinute(m) {
        const all = get("minutes", []);
        const rec = { ...m, id: m.id || uid(), owner: m.owner || me().id, updated_at: new Date().toISOString() };
        delete rec.owner_name;
        set("minutes", [...all.filter((x) => x.id !== rec.id), rec]);
        return rec;
      },
      async deleteMinute(id) { set("minutes", get("minutes", []).filter((m) => m.id !== id)); },

      async getAI() { needAdmin(); return get("ai", {}); },
      async saveAI(ai) { needAdmin(); set("ai", ai); },
      // الوضع التجريبي: تنظيم بسيط للملاحظات دون ذكاء اصطناعي حقيقي
      async generate(notes, ctx) {
        const lines = notes.split(/\n+/).map((l) => l.replace(/^[\s\-•*\d.)]+/, "").trim()).filter(Boolean);
        return {
          title: ctx.title || "",
          attendees: [], opening: "", previous_review: [],
          introduction: lines[0] || "",
          recommendations: lines.slice(1),
          tasks: [],
          _demo: true,
        };
      },
    };
  }

  window.Backend = LIVE ? live() : demo();
})();
