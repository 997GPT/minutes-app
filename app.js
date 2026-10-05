// نظام محاضر الاجتماعات — واجهة المستخدم
(function () {
  const B = window.Backend, Doc = window.MinutesDoc, esc = Doc.esc;
  const $ = (s, r = document) => r.querySelector(s);
  const app = $("#app");

  const DEFAULTS = {
    systemName: "محضر اجتماع", orgName: "", logo: "",
    primary: "#36648b", bg: "#f4f6f8", text: "#1f2937", font: "Cairo", fontSize: 16,
    icons: { app: "📝", list: "📋", add: "➕", admin: "⚙️", users: "👥", theme: "🎨", ai: "🤖", profile: "👤", logout: "🚪", word: "📘", pdf: "📕", print: "🖨️", save: "💾", mic: "🎤" },
  };
  const ICON_LABELS = { app: "شعار النظام", list: "المحاضر", add: "محضر جديد", admin: "الإدارة", users: "المستخدمون", theme: "المظهر", ai: "الذكاء الاصطناعي", profile: "حسابي", logout: "خروج", word: "تصدير Word", pdf: "تصدير PDF", print: "طباعة", save: "حفظ", mic: "الإملاء الصوتي" };
  const FONTS = ["Cairo", "Tajawal", "Almarai", "IBM Plex Sans Arabic", "Noto Kufi Arabic", "Noto Naskh Arabic", "Amiri", "Changa", "El Messiri", "Readex Pro"];
  const STATUSES = ["منجزة", "قيد التنفيذ", "لم تنفذ", "مؤجلة"];

  const S = { st: DEFAULTS, me: null, view: "list", auth: "login", M: null, tab: "users", list: [], pending: 0, notice: "" };
  const today = () => new Date().toLocaleDateString("en-CA");
  const ic = (k) => `<i class="ico">${esc(S.st.icons[k] || "")}</i>`;
  const isAdmin = () => S.me && S.me.role === "admin";

  // ---------------------------------------------------------------- أدوات
  let toastT;
  function toast(msg, err) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "show" + (err ? " err" : "");
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.className = ""), err ? 6000 : 3000);
  }
  async function run(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); }
    catch (e) { console.error(e); toast(e.message || "حدث خطأ", true); }
    finally { if (btn) btn.disabled = false; }
  }
  function applyTheme(st) {
    const r = document.documentElement.style;
    r.setProperty("--primary", st.primary);
    r.setProperty("--bg", st.bg);
    r.setProperty("--text", st.text);
    r.setProperty("--font", `'${st.font}'`);
    r.setProperty("--fs", (st.fontSize || 16) + "px");
    const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(st.font).replace(/%20/g, "+")}:wght@400;700&display=swap`;
    if ($("#font-link").getAttribute("href") !== href) $("#font-link").setAttribute("href", href);
    document.title = st.systemName;
  }
  const mergeSettings = (d) => ({ ...DEFAULTS, ...(d || {}), icons: { ...DEFAULTS.icons, ...((d || {}).icons || {}) } });
  const formData = (f) => Object.fromEntries(new FormData(f).entries());
  function modal(title, body, onSubmit) {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<form class="card"><h3>${title}</h3>${body}
      <div class="row" style="margin-top:1rem"><button class="btn">حفظ</button><button type="button" class="btn soft" data-close>إلغاء</button></div></form>`;
    m.addEventListener("click", (e) => { if (e.target === m || e.target.dataset.close !== undefined) m.remove(); });
    $("form", m).addEventListener("submit", (e) => {
      e.preventDefault();
      run(e.submitter, async () => { await onSubmit(formData(e.target)); m.remove(); });
    });
    document.body.appendChild(m);
    const first = $("input,select", m);
    if (first) first.focus();
  }
  const userFields = (withRole) => `
    <div class="grid">
      <div><label>الاسم الكامل</label><input name="name" required></div>
      <div><label>الرقم الوظيفي</label><input name="employee_no" required inputmode="numeric" autocomplete="username"></div>
      <div><label>البريد الإلكتروني</label><input name="email" type="email" required dir="ltr"></div>
      <div><label>رقم التواصل</label><input name="phone" type="tel" required dir="ltr" pattern="[0-9+\\s\\-]{7,}" title="رقم هاتف صحيح"></div>
      <div><label>كلمة المرور</label><input name="password" type="password" required minlength="6" autocomplete="new-password"></div>
      ${withRole
        ? `<div><label>الصلاحية</label><select name="role"><option value="user">مستخدم</option><option value="admin">مدير نظام</option></select></div>`
        : `<div><label>تأكيد كلمة المرور</label><input name="password2" type="password" required minlength="6" autocomplete="new-password"></div>`}
    </div>`;

  // ---------------------------------------------------------------- الهيكل
  function render() {
    applyTheme(S.st);
    if (!S.me) return renderAuth();
    const nav = [["list", "list", "المحاضر"], ["new", "add", "محضر جديد"], ...(isAdmin() ? [["admin", "admin", "الإدارة" + (S.pending ? ` (${S.pending})` : "")]] : []), ["profile", "profile", S.me.name.split(" ")[0]], ["logout", "logout", "خروج"]];
    const cur = S.view === "edit" || S.view === "preview" ? "" : S.view;
    app.innerHTML = `
      <header class="topbar">
        <div class="brand">${S.st.logo ? `<img src="${S.st.logo}" alt="">` : ic("app")}<span>${esc(S.st.systemName)}</span></div>
        <nav class="nav">${nav.map(([a, i, t]) => `<button data-act="go-${a}" class="${cur === a ? "on" : ""}">${ic(i)} ${esc(t)}</button>`).join("")}</nav>
      </header>
      ${demoBar()}
      <main id="view"></main>`;
    ({ list: viewList, edit: viewEdit, preview: viewPreview, admin: viewAdmin, profile: viewProfile })[S.view]($("#view"));
  }
  const demoBar = () => (B.mode === "demo" ? `<div class="demo">وضع تجريبي: البيانات محفوظة على هذا المتصفح فقط. لتشغيل النظام للجميع عبر الإنترنت اتبع ملف الإعداد README.</div>` : "");

  // ---------------------------------------------------------------- الدخول
  function renderAuth() {
    const reg = S.auth === "register";
    app.innerHTML = `${demoBar()}<main><div class="card auth">
      <div class="logo">${S.st.logo ? `<img src="${S.st.logo}" alt="">` : ic("app")}</div>
      <h1>${esc(S.st.systemName)}</h1>
      <p class="muted" style="text-align:center">${reg ? "إنشاء حساب مستخدم جديد" : "تسجيل الدخول"}</p>
      ${S.notice && !reg ? `<div class="notice">${esc(S.notice)}</div>` : ""}
      <form data-form="${reg ? "register" : "login"}">
        ${reg ? userFields(false) : `
          <div class="field"><label>الرقم الوظيفي</label><input name="employee_no" required autocomplete="username" autofocus></div>
          <div class="field"><label>كلمة المرور</label><input name="password" type="password" required autocomplete="current-password"></div>`}
        <button class="btn" style="margin-top:.9rem">${reg ? "إنشاء الحساب" : "دخول"}</button>
      </form>
      <p style="text-align:center;margin:.9rem 0 0">
        ${reg ? `لديك حساب؟ <button class="link" data-act="auth-login">تسجيل الدخول</button>` : `مستخدم جديد؟ <button class="link" data-act="auth-register">إنشاء حساب</button>`}
      </p>
      ${B.mode === "demo" ? `<p style="text-align:center;margin:.6rem 0 0"><button class="link muted" data-act="reset">تصفير النظام (حذف كل البيانات التجريبية)</button></p>` : ""}
      </div></main>`;
  }

  // ---------------------------------------------------------------- قائمة المحاضر
  async function viewList(el) {
    el.innerHTML = `<div class="card"><h3><span>${ic("list")} محاضر الاجتماعات</span><button class="btn" data-act="go-new">${ic("add")} محضر جديد</button></h3>
      <input id="q" placeholder="بحث بالعنوان أو التاريخ…" style="margin-bottom:.8rem"><div id="rows" class="scroll"><p class="muted">جاري التحميل…</p></div></div>`;
    await run(null, async () => { S.list = await B.listMinutes(); });
    const draw = () => {
      const q = $("#q").value.trim();
      const rows = S.list.filter((m) => !q || (m.title || "").includes(q) || (m.date || "").includes(q) || (m.number || "").includes(q));
      $("#rows").innerHTML = rows.length ? `<table class="list-table"><thead><tr><th>العنوان</th><th>الرقم</th><th>التاريخ</th><th>اليوم</th>${isAdmin() ? "<th>أنشأه</th>" : ""}<th></th></tr></thead><tbody>
        ${rows.map((m) => `<tr><td><b>${esc(m.title || "بدون عنوان")}</b></td><td>${esc(m.number || "")}</td><td>${Doc.fmtDate(m.date)}</td><td>${Doc.dayName(m.date)}</td>${isAdmin() ? `<td>${esc(m.owner_name)}</td>` : ""}
          <td><div class="row" style="justify-content:flex-end">
            <button class="btn sm" data-act="m-view" data-id="${m.id}">عرض وتصدير</button>
            <button class="btn sm ghost" data-act="m-edit" data-id="${m.id}">تعديل</button>
            <button class="btn sm soft" data-act="m-copy" data-id="${m.id}" title="اجتماع جديد يتابع توصيات هذا المحضر">اجتماع متابعة</button>
            <button class="btn sm danger" data-act="m-del" data-id="${m.id}">حذف</button></div></td></tr>`).join("")}</tbody></table>`
        : `<p class="muted">${S.list.length ? "لا توجد نتائج." : "لا توجد محاضر بعد. ابدأ بإنشاء محضر جديد."}</p>`;
    };
    $("#q").addEventListener("input", draw);
    draw();
  }

  // ---------------------------------------------------------------- المحرر
  const blank = () => ({
    title: "", number: "", date: today(), time: "", location: "", dept: S.st.orgName || "",
    attendees: [{ name: S.me.name, role: "" }, { name: "", role: "" }],
    opening: "", introduction: "", previous: [], recommendations: [{ text: "" }],
    tasks: [{ task: "", owner: "", due: "" }], chair: S.me.name, signDate: today(), signature: "", notes: "",
  });
  const fromRecs = (m) => (m.recommendations || []).filter((r) => (r.text || "").trim()).map((r) => ({ item: r.text, status: "قيد التنفيذ", notes: "" }));

  const LISTS = {
    attendees: { cls: "c2", empty: { name: "", role: "" }, row: (a) => `<input data-k="name" placeholder="الاسم" value="${esc(a.name)}"><input data-k="role" placeholder="المسمى / الجهة" value="${esc(a.role)}">` },
    previous: { cls: "c3", empty: { item: "", status: "قيد التنفيذ", notes: "" }, row: (a) => `<input data-k="item" placeholder="التوصية" value="${esc(a.item)}"><select data-k="status">${STATUSES.map((s) => `<option ${s === a.status ? "selected" : ""}>${s}</option>`).join("")}</select><input data-k="notes" placeholder="ملاحظات" value="${esc(a.notes)}">` },
    recommendations: { cls: "", empty: { text: "" }, row: (a) => `<input data-k="text" placeholder="نص التوصية" value="${esc(a.text)}">` },
    tasks: { cls: "ct", empty: { task: "", owner: "", due: "" }, row: (a) => `<input data-k="task" placeholder="المهمة" value="${esc(a.task)}"><input data-k="owner" placeholder="الشخص المعني" value="${esc(a.owner)}"><input data-k="due" type="date" title="موعد الإنجاز" value="${esc(a.due)}">` },
  };
  const listHtml = (name) => {
    const L = LISTS[name];
    return `<div class="items" data-list="${name}">${(S.M[name] || []).map((a, i) => `<div class="item" data-i="${i}"><span class="num">${i + 1}</span><div class="f ${L.cls}">${L.row(a)}</div><button type="button" class="x" data-act="row-del" title="حذف">✕</button></div>`).join("")}
      <button type="button" class="btn sm ghost" data-act="row-add">＋ إضافة</button></div>`;
  };
  const redrawList = (name) => { $(`[data-list="${name}"]`).outerHTML = listHtml(name); };

  function viewEdit(el) {
    const M = S.M;
    const speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    el.innerHTML = `
      <div class="card"><h3>بيانات الاجتماع</h3><div class="grid">
        <div style="grid-column:1/-1"><label>عنوان الاجتماع *</label><input data-f="title" value="${esc(M.title)}" placeholder="مثال: الاجتماع الدوري لإدارة المشاريع"></div>
        <div><label>رقم الاجتماع</label><input data-f="number" value="${esc(M.number)}"></div>
        <div><label>التاريخ *</label><input data-f="date" type="date" value="${esc(M.date)}"></div>
        <div><label>اليوم</label><input id="day" readonly value="${Doc.dayName(M.date)}"></div>
        <div><label>الوقت</label><input data-f="time" type="time" value="${esc(M.time)}"></div>
        <div><label>المكان</label><input data-f="location" value="${esc(M.location)}"></div>
        <div><label>الجهة / الإدارة</label><input data-f="dept" value="${esc(M.dept)}"></div>
      </div></div>

      <div class="card ai-box"><h3><span>${ic("ai")} الصياغة بالذكاء الاصطناعي</span></h3>
        <p class="muted" style="margin-top:0">اكتب ملاحظات الاجتماع كما هي (نقاط، قرارات، من سيفعل ماذا ومتى) وسيحوّلها النظام إلى محضر احترافي، ثم راجع وعدّل ما تشاء.</p>
        <textarea data-f="notes" id="notes" style="min-height:140px" placeholder="مثال: افتتح الاجتماع م. خالد الساعة 10. تمت مراجعة توصيات الاجتماع السابق: تحديث الخطة تم، وعقد الصيانة ما زال قيد التنفيذ. نوقش تأخر المورد… يتولى أحمد إعداد تقرير الميزانية خلال أسبوع…">${esc(M.notes)}</textarea>
        <div class="row" style="margin-top:.6rem">
          <button class="btn" data-act="ai">${ic("ai")} صياغة المحضر</button>
          ${speech ? `<button class="btn ghost" data-act="mic" id="mic">${ic("mic")} إملاء صوتي</button>` : ""}
        </div></div>

      <div class="card"><h3>الحضور</h3>${listHtml("attendees")}</div>
      <div class="card"><h3>الافتتاحية</h3><textarea data-f="opening">${esc(M.opening)}</textarea></div>
      <div class="card"><h3>المقدمة</h3><textarea data-f="introduction">${esc(M.introduction)}</textarea></div>
      <div class="card"><h3><span>مراجعة توصيات الاجتماع السابق</span><button class="btn sm soft" data-act="import-prev">استيراد من آخر محضر</button></h3>${listHtml("previous")}</div>
      <div class="card"><h3>توصيات الاجتماع</h3>${listHtml("recommendations")}</div>
      <div class="card"><h3>المهام الموكلة</h3><p class="muted" style="margin-top:0">لكل مهمة شخص معني وموعد إنجاز.</p>${listHtml("tasks")}</div>

      <div class="card"><h3>الاعتماد</h3><div class="grid">
        <div><label>اسم مدير الاجتماع</label><input data-f="chair" value="${esc(M.chair)}"></div>
        <div><label>التاريخ</label><input data-f="signDate" type="date" value="${esc(M.signDate)}"></div>
      </div>
      <label style="margin-top:.8rem">التوقيع (ارسم توقيعك، أو اتركه فارغاً للتوقيع اليدوي بعد الطباعة)</label>
      <canvas class="pad" id="pad" width="840" height="280"></canvas>
      <button class="btn sm soft" data-act="sig-clear" style="margin-top:.4rem">مسح التوقيع</button></div>

      <div class="bar"><button class="btn" data-act="save">${ic("save")} حفظ</button>
        <button class="btn ghost" data-act="save-preview">حفظ ومعاينة / تصدير</button>
        <button class="btn soft" data-act="go-list">رجوع</button></div>`;
    initPad();
  }

  function initPad() {
    const cv = $("#pad"), ctx = cv.getContext("2d");
    ctx.lineWidth = 3.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0b1f4b";
    if (S.M.signature) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0, cv.width, cv.height); im.src = S.M.signature; }
    let down = false;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) * cv.width) / r.width, ((e.clientY - r.top) * cv.height) / r.height]; };
    cv.addEventListener("pointerdown", (e) => { down = true; cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); });
    cv.addEventListener("pointermove", (e) => { if (down) { ctx.lineTo(...pos(e)); ctx.stroke(); } });
    const up = () => { if (down) { down = false; S.M.signature = cv.toDataURL("image/png"); } };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
  }

  function validate() {
    const M = S.M;
    if (!M.title.trim()) return "أدخل عنوان الاجتماع";
    if (!M.date) return "حدد تاريخ الاجتماع";
    const bad = (M.tasks || []).findIndex((t) => (t.task || "").trim() && (!(t.owner || "").trim() || !t.due));
    if (bad >= 0) return `المهمة رقم ${bad + 1}: حدد الشخص المعني وموعد الإنجاز`;
    return "";
  }
  async function save() {
    const err = validate();
    if (err) throw new Error(err);
    S.M = await B.saveMinute(S.M);
    toast("تم حفظ المحضر");
  }

  async function aiGenerate() {
    const M = S.M;
    if (!M.notes.trim()) throw new Error("اكتب ملاحظات الاجتماع أولاً");
    const has = M.opening.trim() || M.introduction.trim() || M.recommendations.some((r) => r.text.trim()) || M.tasks.some((t) => t.task.trim());
    if (has && !confirm("سيتم استبدال محتوى الأقسام الحالية بالصياغة الجديدة. متابعة؟")) return;
    toast("جاري الصياغة… قد تستغرق بضع ثوانٍ");
    const r = await B.generate(M.notes, {
      date: M.date, title: M.title,
      attendees: M.attendees.filter((a) => a.name.trim()),
      previous: M.previous.filter((p) => p.item.trim()).map((p) => p.item),
    });
    const str = (v) => (typeof v === "string" ? v.trim() : "");
    const arr = (v) => (Array.isArray(v) ? v : []);
    if (str(r.title) && !M.title.trim()) M.title = str(r.title);
    const att = arr(r.attendees).map((a) => ({ name: str(a.name), role: str(a.role) })).filter((a) => a.name);
    if (att.length) {
      const known = new Set(M.attendees.map((a) => a.name.trim()));
      M.attendees = [...M.attendees.filter((a) => a.name.trim()), ...att.filter((a) => !known.has(a.name))];
    }
    M.opening = str(r.opening) || M.opening;
    M.introduction = str(r.introduction) || M.introduction;
    const prev = arr(r.previous_review).map((p) => ({ item: str(p.item), status: STATUSES.includes(str(p.status)) ? str(p.status) : "قيد التنفيذ", notes: str(p.notes) })).filter((p) => p.item);
    if (prev.length) M.previous = prev;
    const recs = arr(r.recommendations).map((x) => ({ text: str(typeof x === "string" ? x : x && x.text) })).filter((x) => x.text);
    if (recs.length) M.recommendations = recs;
    const tasks = arr(r.tasks).map((t) => ({ task: str(t.task), owner: str(t.owner), due: /^\d{4}-\d{2}-\d{2}$/.test(str(t.due)) ? str(t.due) : "" })).filter((t) => t.task);
    if (tasks.length) M.tasks = tasks;
    render();
    toast(r._demo ? "وضع تجريبي: تم تنظيم الملاحظات بشكل مبسط. الصياغة الذكية تعمل بعد ربط النظام." : "تمت الصياغة. راجع المحضر وأكمل ما ينقص.");
  }

  let rec = null;
  function toggleMic(btn) {
    if (rec) { rec.stop(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    rec = new SR();
    rec.lang = "ar-SA"; rec.continuous = true; rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) S.M.notes = (S.M.notes + " " + e.results[i][0].transcript).trim();
      const n = $("#notes"); if (n) n.value = S.M.notes;
    };
    rec.onerror = (e) => toast("تعذر الإملاء الصوتي: " + e.error, true);
    rec.onend = () => { rec = null; const b = $("#mic"); if (b) b.innerHTML = `${ic("mic")} إملاء صوتي`; };
    rec.start();
    btn.innerHTML = "⏹ إيقاف الإملاء";
  }

  // ---------------------------------------------------------------- المعاينة
  function viewPreview(el) {
    el.innerHTML = `<div class="card no-print"><div class="row">
        <button class="btn" data-act="x-word">${ic("word")} تصدير Word</button>
        <button class="btn" data-act="x-pdf">${ic("pdf")} تصدير PDF</button>
        <button class="btn ghost" data-act="x-print">${ic("print")} طباعة</button>
        <button class="btn soft" data-act="m-back">تعديل</button>
        <button class="btn soft" data-act="go-list">المحاضر</button></div></div>
      <div class="paper-wrap"><div class="paper" id="paper" dir="rtl">${Doc.html(S.M, S.st)}</div></div>`;
  }

  // ---------------------------------------------------------------- الإدارة
  function viewAdmin(el) {
    if (!isAdmin()) { S.view = "list"; return render(); }
    const tabs = [["users", "المستخدمون"], ["theme", "المظهر"], ["ai", "الذكاء الاصطناعي"]];
    el.innerHTML = `<div class="tabs">${tabs.map(([k, t]) => `<button data-act="tab-${k}" class="${S.tab === k ? "on" : ""}">${ic(k)} ${t}</button>`).join("")}</div><div id="tab"></div>`;
    ({ users: tabUsers, theme: tabTheme, ai: tabAI })[S.tab]($("#tab"));
  }

  async function tabUsers(el) {
    el.innerHTML = `<div class="card"><h3><span>${ic("users")} المستخدمون</span><button class="btn" data-act="u-add">${ic("add")} مستخدم جديد</button></h3><div id="users" class="scroll"><p class="muted">جاري التحميل…</p></div></div>`;
    await run(null, async () => {
      S.users = (await B.listUsers()).sort((a, b) => (b.pending ? 1 : 0) - (a.pending ? 1 : 0));
      const n = S.users.filter((u) => u.pending).length;
      if (n !== S.pending) { S.pending = n; return render(); }
      $("#users").innerHTML = `<table class="list-table"><thead><tr><th>الرقم الوظيفي</th><th>الاسم</th><th>البريد</th><th>رقم التواصل</th><th>الصلاحية</th><th>الحالة</th><th></th></tr></thead><tbody>
        ${S.users.map((u) => `<tr><td>${esc(u.employee_no)}</td><td><b>${esc(u.name)}</b></td><td dir="ltr">${esc(u.email)}</td><td dir="ltr">${esc(u.phone)}</td>
          <td><span class="badge ${u.role === "admin" ? "adm" : ""}">${u.role === "admin" ? "مدير نظام" : "مستخدم"}</span></td>
          <td><span class="badge ${u.active ? "ok" : u.pending ? "wait" : "off"}">${u.active ? "مفعّل" : u.pending ? "بانتظار الموافقة" : "موقوف"}</span></td>
          <td><div class="row" style="justify-content:flex-end">
            <button class="btn sm ghost" data-act="u-edit" data-id="${u.id}">تعديل</button>
            <button class="btn sm soft" data-act="u-pw" data-id="${u.id}">كلمة المرور</button>
            ${u.id === S.me.id ? "" : u.pending
              ? `<button class="btn sm" data-act="u-toggle" data-id="${u.id}">موافقة</button>
            <button class="btn sm danger" data-act="u-del" data-id="${u.id}">رفض</button>`
              : `<button class="btn sm soft" data-act="u-toggle" data-id="${u.id}">${u.active ? "إيقاف" : "تفعيل"}</button>
            <button class="btn sm danger" data-act="u-del" data-id="${u.id}">حذف</button>`}</div></td></tr>`).join("")}</tbody></table>`;
    });
  }

  function tabTheme(el) {
    const st = S.st;
    el.innerHTML = `<form class="card" data-form="theme"><h3>${ic("theme")} مظهر النظام</h3>
      <div class="grid">
        <div><label>اسم النظام</label><input name="systemName" value="${esc(st.systemName)}" required></div>
        <div><label>اسم الجهة (يظهر أعلى المحضر)</label><input name="orgName" value="${esc(st.orgName)}"></div>
        <div><label>نوع الخط</label><select name="font">${FONTS.map((f) => `<option ${f === st.font ? "selected" : ""}>${f}</option>`).join("")}</select></div>
        <div><label>حجم الخط</label><input name="fontSize" type="number" min="13" max="20" value="${st.fontSize}"></div>
        <div><label>لون النظام الأساسي</label><input name="primary" type="color" value="${st.primary}"></div>
        <div><label>لون الخط</label><input name="text" type="color" value="${st.text}"></div>
        <div><label>لون الخلفية</label><input name="bg" type="color" value="${st.bg}"></div>
        <div><label>شعار النظام (صورة)</label><input type="file" id="logo-file" accept="image/*">
          ${st.logo ? `<div class="row" style="margin-top:.4rem"><img src="${st.logo}" style="height:40px"><button type="button" class="btn sm soft" data-act="logo-clear">إزالة الشعار</button></div>` : ""}</div>
      </div>
      <h3 style="margin-top:1.2rem">رموز النظام</h3>
      <p class="muted" style="margin-top:0">اكتب أو الصق أي رمز تعبيري (Emoji) لكل عنصر.</p>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
        ${Object.keys(DEFAULTS.icons).map((k) => `<div><label>${ICON_LABELS[k]}</label><input name="icon_${k}" value="${esc(st.icons[k])}" maxlength="8" style="text-align:center;font-size:1.3rem"></div>`).join("")}
      </div>
      <div class="row" style="margin-top:1.2rem"><button class="btn">${ic("save")} حفظ المظهر</button>
        <button type="button" class="btn soft" data-act="theme-reset">استعادة الافتراضي</button></div></form>`;
    const form = $("form", el);
    form.addEventListener("input", (e) => { if (e.target.type !== "file") applyTheme(readTheme(form)); });
    $("#logo-file").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, 320 / Math.max(im.width, im.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
        cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
        S.st = { ...readTheme(form), logo: cv.toDataURL("image/png") };
        render();
        toast("تم تحميل الشعار. اضغط «حفظ المظهر» لاعتماده.");
      };
      im.onerror = () => toast("تعذر قراءة الصورة", true);
      im.src = URL.createObjectURL(f);
    });
  }
  function readTheme(form) {
    const d = formData(form), icons = {};
    Object.keys(DEFAULTS.icons).forEach((k) => (icons[k] = d["icon_" + k] || ""));
    return { ...S.st, systemName: d.systemName.trim() || DEFAULTS.systemName, orgName: d.orgName.trim(), font: d.font, fontSize: Math.min(20, Math.max(13, +d.fontSize || 16)), primary: d.primary, text: d.text, bg: d.bg, icons };
  }

  async function tabAI(el) {
    el.innerHTML = `<div class="card"><p class="muted">جاري التحميل…</p></div>`;
    await run(null, async () => {
      const a = await B.getAI();
      const p = a.provider || "gemini";
      el.innerHTML = `<form class="card" data-form="ai"><h3>${ic("ai")} إعدادات الذكاء الاصطناعي</h3>
        <p class="muted" style="margin-top:0">يُحفظ المفتاح في الخادم ولا يراه المستخدمون. يمكن الحصول على مفتاح Gemini مجاني من <span dir="ltr">aistudio.google.com/apikey</span></p>
        <div class="grid">
          <div><label>المزوّد</label><select name="provider">
            <option value="gemini" ${p === "gemini" ? "selected" : ""}>Google Gemini (يتوفر مفتاح مجاني)</option>
            <option value="anthropic" ${p === "anthropic" ? "selected" : ""}>Anthropic Claude</option>
            <option value="openai" ${p === "openai" ? "selected" : ""}>OpenAI أو متوافق معه</option></select></div>
          <div><label>اسم النموذج (اختياري)</label><input name="model" dir="ltr" value="${esc(a.model || "")}" placeholder="gemini-flash-latest"></div>
          <div><label>رابط الخدمة (للمتوافق مع OpenAI فقط)</label><input name="base" dir="ltr" value="${esc(a.base || "")}" placeholder="https://api.openai.com/v1"></div>
          <div><label>مفتاح API</label><input name="key" type="password" dir="ltr" value="${esc(a.key || "")}" autocomplete="off"></div>
        </div>
        <button class="btn" style="margin-top:1rem">${ic("save")} حفظ</button>
        ${B.mode === "demo" ? `<p class="muted">ملاحظة: في الوضع التجريبي لا يُستخدم المفتاح؛ الصياغة الذكية تعمل بعد ربط النظام بقاعدة البيانات.</p>` : ""}</form>`;
    });
  }

  // ---------------------------------------------------------------- حسابي
  function viewProfile(el) {
    const u = S.me;
    el.innerHTML = `<form class="card" data-form="profile"><h3>${ic("profile")} بياناتي</h3><div class="grid">
        <div><label>الرقم الوظيفي</label><input value="${esc(u.employee_no)}" readonly></div>
        <div><label>البريد الإلكتروني</label><input value="${esc(u.email)}" readonly dir="ltr"></div>
        <div><label>الاسم</label><input name="name" value="${esc(u.name)}" required></div>
        <div><label>رقم التواصل</label><input name="phone" value="${esc(u.phone)}" required dir="ltr"></div>
      </div><button class="btn" style="margin-top:1rem">حفظ</button></form>
      <form class="card" data-form="password"><h3>تغيير كلمة المرور</h3><div class="grid">
        <div><label>كلمة المرور الجديدة</label><input name="password" type="password" required minlength="6" autocomplete="new-password"></div>
        <div><label>تأكيدها</label><input name="password2" type="password" required minlength="6" autocomplete="new-password"></div>
      </div><button class="btn" style="margin-top:1rem">تغيير</button></form>`;
  }

  // ---------------------------------------------------------------- الأحداث
  const FORMS = {
    async login(d) { S.me = await B.login(d.employee_no, d.password); S.notice = ""; S.view = "list"; render(); refreshPending(); },
    async register(d) {
      if (d.password !== d.password2) throw new Error("كلمتا المرور غير متطابقتين");
      const r = await B.register(d);
      if (r && r.pending) {
        S.auth = "login";
        S.notice = "تم استلام طلب التسجيل. سيتمكن حسابك من الدخول بعد موافقة مدير النظام.";
        return render();
      }
      S.me = r; S.view = "list"; render();
      toast("تم إنشاء الحساب، أهلاً بك");
    },
    async theme(d, form) { S.st = readTheme(form); await B.saveSettings(S.st); render(); toast("تم حفظ المظهر"); },
    async ai(d) { await B.saveAI({ provider: d.provider, model: d.model.trim(), base: d.base.trim(), key: d.key.trim() }); toast("تم حفظ إعدادات الذكاء الاصطناعي"); },
    async profile(d) { await B.updateProfile(d); S.me = { ...S.me, name: d.name.trim(), phone: d.phone.trim() }; render(); toast("تم الحفظ"); },
    async password(d, form) {
      if (d.password !== d.password2) throw new Error("كلمتا المرور غير متطابقتين");
      await B.changePassword(d.password); form.reset(); toast("تم تغيير كلمة المرور");
    },
  };
  app.addEventListener("submit", (e) => {
    const f = e.target.closest("[data-form]");
    if (!f) return;
    e.preventDefault();
    run(e.submitter, () => FORMS[f.dataset.form](formData(f), f));
  });

  // ربط حقول المحرر بالنموذج
  app.addEventListener("input", (e) => {
    const t = e.target;
    if (S.view !== "edit" || !S.M) return;
    if (t.dataset.f) {
      S.M[t.dataset.f] = t.value;
      if (t.dataset.f === "date") $("#day").value = Doc.dayName(t.value);
    } else if (t.dataset.k) {
      const item = t.closest(".item"), list = t.closest("[data-list]");
      S.M[list.dataset.list][+item.dataset.i][t.dataset.k] = t.value;
    }
  });

  // عدد طلبات التسجيل التي تنتظر موافقة المدير (يظهر بجانب «الإدارة»)
  async function refreshPending() {
    if (!isAdmin()) return;
    try {
      const n = (await B.listUsers()).filter((u) => u.pending).length;
      if (n !== S.pending) { S.pending = n; if (S.view !== "edit") render(); }
    } catch (e) { console.error(e); }
  }
  const go = (v) => { S.view = v; render(); window.scrollTo(0, 0); };
  const byId = (id) => S.list.find((m) => m.id === id);
  const user = (id) => S.users.find((u) => u.id === id);
  const ACTS = {
    reset: () => { if (confirm("سيُحذف جميع المستخدمين والمحاضر والإعدادات المحفوظة على هذا المتصفح، ويعود النظام إلى حالته الأولى. متابعة؟")) B.reset(); },
    "auth-login": () => { S.auth = "login"; render(); },
    "auth-register": () => { S.auth = "register"; render(); },
    "go-list": () => go("list"),
    "go-new": () => { S.M = blank(); go("edit"); },
    "go-admin": () => go("admin"),
    "go-profile": () => go("profile"),
    "go-logout": async () => { await B.logout(); S.me = null; S.auth = "login"; render(); },
    "m-view": (b) => { S.M = structuredClone(byId(b.dataset.id)); go("preview"); },
    "m-edit": (b) => { S.M = { ...blank(), ...structuredClone(byId(b.dataset.id)) }; go("edit"); },
    "m-back": () => { S.M = { ...blank(), ...S.M }; go("edit"); },
    "m-copy": (b) => {
      const src = byId(b.dataset.id);
      S.M = { ...blank(), title: src.title, location: src.location || "", dept: src.dept || "", time: src.time || "", attendees: structuredClone(src.attendees || []), previous: fromRecs(src) };
      go("edit");
      toast("محضر جديد: تم نقل توصيات الاجتماع السابق للمراجعة");
    },
    "m-del": async (b) => {
      if (!confirm("حذف هذا المحضر نهائياً؟")) return;
      await B.deleteMinute(b.dataset.id); toast("تم الحذف"); render();
    },
    "row-add": (b) => { const n = b.closest("[data-list]").dataset.list; S.M[n].push({ ...LISTS[n].empty }); redrawList(n); },
    "row-del": (b) => { const n = b.closest("[data-list]").dataset.list; S.M[n].splice(+b.closest(".item").dataset.i, 1); redrawList(n); },
    "sig-clear": () => { const cv = $("#pad"); cv.getContext("2d").clearRect(0, 0, cv.width, cv.height); S.M.signature = ""; },
    "import-prev": async () => {
      const all = await B.listMinutes();
      const prev = all.filter((m) => m.id !== S.M.id && (!S.M.date || !m.date || m.date <= S.M.date))[0];
      if (!prev) throw new Error("لا يوجد محضر سابق");
      const items = fromRecs(prev);
      if (!items.length) throw new Error("المحضر السابق لا يحتوي توصيات");
      S.M.previous = items; redrawList("previous");
      toast(`تم استيراد ${items.length} توصية من: ${prev.title}`);
    },
    ai: aiGenerate,
    mic: (b) => toggleMic(b),
    save,
    "save-preview": async () => { await save(); go("preview"); },
    "x-word": () => Doc.word(S.M, S.st),
    "x-pdf": async () => {
      try { await Doc.pdf($("#paper"), S.M, S.st); }
      catch (e) { console.error(e); toast("سيُفتح مربع الطباعة: اختر «حفظ بتنسيق PDF»"); setTimeout(() => window.print(), 600); }
    },
    "x-print": () => window.print(),
    "tab-users": () => { S.tab = "users"; render(); },
    "tab-theme": () => { S.tab = "theme"; render(); },
    "tab-ai": () => { S.tab = "ai"; render(); },
    "logo-clear": () => { S.st = { ...S.st, logo: "" }; render(); toast("اضغط «حفظ المظهر» لاعتماد التغيير"); },
    "theme-reset": async () => { if (!confirm("استعادة المظهر الافتراضي؟")) return; S.st = mergeSettings({}); await B.saveSettings(S.st); render(); toast("تمت الاستعادة"); },
    "u-add": () => modal("مستخدم جديد", userFields(true), async (d) => { await B.adminCreateUser(d); toast("تم إنشاء المستخدم"); render(); }),
    "u-edit": (b) => {
      const u = user(b.dataset.id);
      modal("تعديل المستخدم", `<div class="grid">
          <div><label>الاسم</label><input name="name" value="${esc(u.name)}" required></div>
          <div><label>رقم التواصل</label><input name="phone" value="${esc(u.phone)}" required dir="ltr"></div>
          <div><label>الصلاحية</label><select name="role" ${u.id === S.me.id ? "disabled" : ""}><option value="user">مستخدم</option><option value="admin" ${u.role === "admin" ? "selected" : ""}>مدير نظام</option></select></div></div>`,
        async (d) => {
          await B.adminUpdateUser(u.id, { name: d.name.trim(), phone: d.phone.trim(), ...(d.role ? { role: d.role } : {}) });
          if (u.id === S.me.id) S.me = { ...S.me, name: d.name.trim(), phone: d.phone.trim() };
          toast("تم التعديل"); render();
        });
      if (u.role !== "admin") $(".modal select").value = "user";
    },
    "u-pw": (b) => modal("كلمة مرور جديدة: " + esc(user(b.dataset.id).name), `<label>كلمة المرور الجديدة</label><input name="password" type="password" required minlength="6" autocomplete="new-password">`,
      async (d) => { await B.adminResetPassword(b.dataset.id, d.password); toast("تم تغيير كلمة المرور"); }),
    "u-toggle": async (b) => {
      const u = user(b.dataset.id);
      await B.adminUpdateUser(u.id, { active: !u.active, pending: false });
      toast(u.pending ? "تمت الموافقة على المستخدم" : u.active ? "تم إيقاف الحساب" : "تم تفعيل الحساب"); render();
    },
    "u-del": async (b) => {
      const u = user(b.dataset.id);
      if (!confirm(u.pending ? `رفض طلب «${u.name}» وحذفه؟` : `حذف المستخدم «${u.name}» وجميع محاضره نهائياً؟`)) return;
      await B.adminDeleteUser(u.id); toast(u.pending ? "تم رفض الطلب" : "تم حذف المستخدم"); render();
    },
  };
  app.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || !ACTS[b.dataset.act]) return;
    if (b.tagName === "BUTTON" && b.type === "submit" && !b.closest("form")) b.type = "button";
    e.preventDefault();
    run(b, () => ACTS[b.dataset.act](b));
  });

  // ---------------------------------------------------------------- البدء
  (async function init() {
    try {
      S.st = mergeSettings(await B.getSettings());
      S.me = await B.session();
    } catch (e) {
      console.error(e);
      app.innerHTML = `<main><div class="card auth"><h1>تعذر الاتصال بقاعدة البيانات</h1><p>تحقق من القيم في ملف <b dir="ltr">config.js</b> ومن تنفيذ ملف <b dir="ltr">schema.sql</b> في Supabase.</p><p class="muted" dir="ltr">${esc(e.message)}</p></div></main>`;
      return;
    }
    render();
    refreshPending();
  })();
})();
