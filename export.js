// عرض المحضر (HTML) وتصديره إلى Word و PDF
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (d) => (d ? String(d).split("-").join("/") : "");
  const dayName = (d) => {
    if (!d) return "";
    const t = new Date(d + "T12:00:00");
    return isNaN(t) ? "" : t.toLocaleDateString("ar", { weekday: "long" });
  };
  const clean = (m) => ({
    attendees: (m.attendees || []).filter((a) => (a.name || "").trim()),
    previous: (m.previous || []).filter((a) => (a.item || "").trim()),
    recommendations: (m.recommendations || []).filter((a) => (a.text || "").trim()),
    tasks: (m.tasks || []).filter((a) => (a.task || "").trim()),
  });
  const info = (m) => [
    ["رقم الاجتماع", m.number], ["التاريخ", fmtDate(m.date)], ["اليوم", dayName(m.date)],
    ["الوقت", m.time], ["المكان", m.location], ["الجهة / الإدارة", m.dept],
  ].filter((x) => x[1]);
  const fileName = (m) => `محضر اجتماع - ${(m.title || "بدون عنوان").replace(/[\\/:*?"<>|]/g, " ")}${m.date ? " - " + m.date : ""}`;

  // ---------------------------------------------------------------- HTML
  function html(m, st) {
    const c = clean(m);
    const paras = (t) => String(t || "").split(/\n+/).filter((x) => x.trim()).map((x) => `<p>${esc(x)}</p>`).join("");
    const table = (heads, rows, widths) => `<table><thead><tr>${heads.map((h, i) => `<th style="width:${widths[i]}">${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((x) => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    const empty = '<p class="muted">لا يوجد.</p>';
    let n = 0;
    const sec = (title, body) => `<section><h3>${["أولاً", "ثانياً", "ثالثاً", "رابعاً", "خامساً", "سادساً"][n++]}: ${title}</h3>${body}</section>`;
    return `
    <div class="doc-head">
      ${st.logo ? `<img src="${st.logo}" alt="">` : ""}
      ${st.orgName ? `<div class="org">${esc(st.orgName)}</div>` : ""}
      <h1>محضر اجتماع</h1>
      ${m.title ? `<h2>${esc(m.title)}</h2>` : ""}
    </div>
    <table class="info"><tbody>${info(m).map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>
    ${sec("الحضور", c.attendees.length ? table(["م", "الاسم", "المسمى / الجهة"], c.attendees.map((a, i) => [i + 1, a.name, a.role]), ["8%", "46%", "46%"]) : empty)}
    ${sec("الافتتاحية", paras(m.opening) || empty)}
    ${sec("المقدمة", paras(m.introduction) || empty)}
    ${sec("مراجعة توصيات الاجتماع السابق", c.previous.length ? table(["م", "التوصية", "الحالة", "ملاحظات"], c.previous.map((a, i) => [i + 1, a.item, a.status, a.notes]), ["8%", "46%", "16%", "30%"]) : empty)}
    ${sec("توصيات الاجتماع", c.recommendations.length ? `<ol>${c.recommendations.map((r) => `<li>${esc(r.text)}</li>`).join("")}</ol>` : empty)}
    ${sec("المهام الموكلة", c.tasks.length ? table(["م", "المهمة", "الشخص المعني", "موعد الإنجاز"], c.tasks.map((a, i) => [i + 1, a.task, a.owner, fmtDate(a.due)]), ["8%", "48%", "24%", "20%"]) : empty)}
    <div class="sign">
      <div><b>مدير الاجتماع:</b> ${esc(m.chair)}</div>
      <div><b>التاريخ:</b> ${esc(fmtDate(m.signDate))}</div>
      <div class="sig"><b>التوقيع:</b> ${m.signature ? `<img src="${m.signature}" alt="">` : '<span class="line"></span>'}</div>
    </div>`;
  }

  // ---------------------------------------------------------------- PDF
  // يُرسم المحضر بمحرك المتصفح نفسه (لضمان سلامة النص العربي) ثم يقسَّم إلى صفحات A4
  // دون قطع أي سطر أو صف جدول.
  const FALLBACK_FONT = "Tahoma, Arial, sans-serif";
  const fontCache = {};
  async function embedFont(family) {
    if (fontCache[family]) return fontCache[family];
    const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;700&display=swap`;
    let css = await (await fetch(url)).text();
    const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((x) => x[1]))];
    if (!urls.length) throw new Error("no font files");
    await Promise.all(urls.map(async (u) => {
      const blob = await (await fetch(u)).blob();
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
      css = css.split(u).join(data);
    }));
    return (fontCache[family] = css);
  }

  async function rasterize(el, w, h, scale, fontCss, fontFamily) {
    const xml = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
    const cs = getComputedStyle(document.documentElement);
    const vars = ["--primary", "--bg", "--text", "--line", "--muted"].map((v) => `${v}:${cs.getPropertyValue(v).trim()}`).join(";");
    const clone = el.cloneNode(true);
    clone.style.margin = "0";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject x="0" y="0" width="${w}" height="${h}">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" dir="rtl" style="${vars};width:${w}px;font-family:${fontFamily.replace(/"/g, "'")}">` +
      `<style>${xml(fontCss + css)}</style>${new XMLSerializer().serializeToString(clone)}</div></foreignObject></svg>`;
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("svg")); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
    if (img.decode) await img.decode().catch(() => {});
    await new Promise((r) => setTimeout(r, 150)); // مهلة لتحميل الخطوط المضمّنة
    const cv = document.createElement("canvas");
    cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    cv.toDataURL("image/png", 0.1).length; // يرمي خطأً إن منع المتصفح القراءة (Safari)
    return cv;
  }

  async function pdf(el, m, st) {
    const PW = 210, PH = 297, MX = 10, MT = 12, MB = 16;
    let fontCss = "", family = `'${st.font}', ${FALLBACK_FONT}`;
    try { fontCss = await embedFont(st.font); } catch { family = FALLBACK_FONT; }
    const oldFont = el.style.fontFamily;
    el.style.fontFamily = family;
    el.classList.add("exporting");
    try {
      await document.fonts.ready;
      const w = el.offsetWidth, h = el.offsetHeight;
      const mm = (PW - 2 * MX) / w, pagePx = (PH - MT - MB) / mm;
      const top0 = el.getBoundingClientRect().top;
      const blocks = [...el.querySelectorAll("tr,p,li,h1,h2,h3,img,.sign>div")].map((b) => {
        const r = b.getBoundingClientRect();
        return { t: r.top - top0, b: r.bottom - top0, keep: b.tagName === "H3" || !!b.closest("thead") };
      });
      const cuts = [0];
      while (cuts[cuts.length - 1] + pagePx < h) {
        const start = cuts[cuts.length - 1];
        let y = start + pagePx, moved = true;
        while (moved) {
          moved = false;
          for (const k of blocks) {
            const inside = k.t < y - 0.5 && k.b > y + 0.5;
            const orphan = k.keep && k.b <= y + 0.5 && y - k.b < 16;
            if ((inside || orphan) && k.t > start + 1) { y = k.t; moved = true; }
          }
        }
        cuts.push(y);
      }
      cuts.push(h);
      const scale = Math.min(2, 30000 / h);
      const cv = await rasterize(el, w, h, scale, fontCss, family);
      const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
      const pages = cuts.length - 1;
      for (let i = 0; i < pages; i++) {
        const y0 = Math.round(cuts[i] * scale), y1 = Math.round(cuts[i + 1] * scale);
        const pc = document.createElement("canvas");
        pc.width = cv.width; pc.height = Math.max(1, y1 - y0);
        const ctx = pc.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, pc.width, pc.height);
        ctx.drawImage(cv, 0, y0, cv.width, pc.height, 0, 0, pc.width, pc.height);
        if (i) doc.addPage();
        doc.addImage(pc.toDataURL("image/jpeg", 0.95), "JPEG", MX, MT, PW - 2 * MX, (pc.height / scale) * mm);
        doc.setFontSize(9); doc.setTextColor(120);
        doc.text(`${i + 1} / ${pages}`, PW / 2, PH - 7, { align: "center" });
      }
      doc.save(fileName(m) + ".pdf");
    } finally {
      el.style.fontFamily = oldFont;
      el.classList.remove("exporting");
    }
  }

  // ---------------------------------------------------------------- Word
  async function word(m, st) {
    const D = window.docx;
    const c = clean(m);
    const FONT = "Arial";
    const color = (st.primary || "#0f766e").replace("#", "");
    const W = 9638; // عرض المحتوى (A4 بهوامش 2 سم)
    const run = (text, o = {}) => new D.TextRun({ text: String(text ?? ""), rightToLeft: true, font: FONT, size: 24, ...o });
    const P = (text, o = {}, po = {}) => new D.Paragraph({ bidirectional: true, spacing: { after: 120, line: 340 }, ...po, children: [run(text, o)] });
    const paras = (t) => String(t || "").split(/\n+/).filter((x) => x.trim()).map((x) => P(x, {}, { alignment: D.AlignmentType.BOTH }));
    const border = { style: D.BorderStyle.SINGLE, size: 6, color: "999999" };
    const borders = { top: border, bottom: border, left: border, right: border };
    const cell = (text, w, head, o = {}) => new D.TableCell({
      width: { size: w, type: D.WidthType.DXA }, borders,
      margins: { top: 80, bottom: 80, left: 110, right: 110 },
      verticalAlign: D.VerticalAlign.CENTER,
      shading: head ? { fill: color, type: D.ShadingType.CLEAR, color: "auto" } : o.fill ? { fill: o.fill, type: D.ShadingType.CLEAR, color: "auto" } : undefined,
      children: [P(text, head ? { bold: true, color: "FFFFFF" } : { bold: !!o.bold }, { spacing: { after: 0 }, alignment: o.center || head ? D.AlignmentType.CENTER : undefined })],
    });
    const table = (heads, rows, pct, centerCols = [0]) => {
      const ws = pct.map((p) => Math.round((W * p) / 100));
      return new D.Table({
        visuallyRightToLeft: true, width: { size: W, type: D.WidthType.DXA }, columnWidths: ws,
        rows: [
          new D.TableRow({ tableHeader: true, children: heads.map((h, i) => cell(h, ws[i], true)) }),
          ...rows.map((r) => new D.TableRow({ cantSplit: true, children: r.map((x, i) => cell(x, ws[i], false, { center: centerCols.includes(i) })) })),
        ],
      });
    };
    const empty = () => P("لا يوجد.", { color: "777777" });
    const ord = ["أولاً", "ثانياً", "ثالثاً", "رابعاً", "خامساً", "سادساً"];
    let n = 0;
    const H = (t) => new D.Paragraph({
      bidirectional: true, keepNext: true, spacing: { before: 320, after: 140 },
      border: { bottom: { style: D.BorderStyle.SINGLE, size: 8, color, space: 4 } },
      children: [run(`${ord[n++]}: ${t}`, { bold: true, size: 28, color })],
    });
    const center = D.AlignmentType.CENTER;
    const body = [];

    const img = (dataUrl, maxW, maxH) => new Promise((res) => {
      if (!dataUrl) return res(null);
      const im = new Image();
      im.onload = () => {
        const k = Math.min(maxW / im.width, maxH / im.height, 1);
        const cv = document.createElement("canvas");
        cv.width = im.width; cv.height = im.height;
        cv.getContext("2d").drawImage(im, 0, 0);
        cv.toBlob(async (b) => res(b && new D.ImageRun({ type: "png", data: new Uint8Array(await b.arrayBuffer()), transformation: { width: Math.round(im.width * k), height: Math.round(im.height * k) } })), "image/png");
      };
      im.onerror = () => res(null);
      im.src = dataUrl;
    });

    const logo = await img(st.logo, 110, 80);
    if (logo) body.push(new D.Paragraph({ alignment: center, spacing: { after: 100 }, children: [logo] }));
    if (st.orgName) body.push(P(st.orgName, { bold: true, size: 26 }, { alignment: center, spacing: { after: 60 } }));
    body.push(P("محضر اجتماع", { bold: true, size: 40, color }, { alignment: center, spacing: { after: 60 } }));
    if (m.title) body.push(P(m.title, { bold: true, size: 30 }, { alignment: center, spacing: { after: 240 } }));

    const inf = info(m);
    if (inf.length) {
      const ws = [Math.round(W * 0.26), W - Math.round(W * 0.26)];
      body.push(new D.Table({
        visuallyRightToLeft: true, width: { size: W, type: D.WidthType.DXA }, columnWidths: ws,
        rows: inf.map(([k, v]) => new D.TableRow({ children: [cell(k, ws[0], false, { bold: true, fill: "F1F3F5" }), cell(v, ws[1], false)] })),
      }));
    }

    body.push(H("الحضور"));
    body.push(c.attendees.length ? table(["م", "الاسم", "المسمى / الجهة"], c.attendees.map((a, i) => [i + 1, a.name, a.role]), [8, 46, 46]) : empty());
    body.push(H("الافتتاحية"), ...(paras(m.opening).length ? paras(m.opening) : [empty()]));
    body.push(H("المقدمة"), ...(paras(m.introduction).length ? paras(m.introduction) : [empty()]));
    body.push(H("مراجعة توصيات الاجتماع السابق"));
    body.push(c.previous.length ? table(["م", "التوصية", "الحالة", "ملاحظات"], c.previous.map((a, i) => [i + 1, a.item, a.status, a.notes]), [8, 46, 16, 30], [0, 2]) : empty());
    body.push(H("توصيات الاجتماع"));
    if (c.recommendations.length) c.recommendations.forEach((r, i) => body.push(P(`${i + 1}. ${r.text}`, {}, { indent: { start: 300, hanging: 300 } })));
    else body.push(empty());
    body.push(H("المهام الموكلة"));
    body.push(c.tasks.length ? table(["م", "المهمة", "الشخص المعني", "موعد الإنجاز"], c.tasks.map((a, i) => [i + 1, a.task, a.owner, fmtDate(a.due)]), [8, 48, 24, 20], [0, 3]) : empty());

    const sig = await img(m.signature, 180, 70);
    const line = (label, value) => new D.Paragraph({ bidirectional: true, keepNext: true, spacing: { after: 140 }, children: [run(label + " ", { bold: true }), run(value || "")] });
    body.push(new D.Paragraph({ spacing: { before: 500 }, children: [] }));
    body.push(line("مدير الاجتماع:", m.chair), line("التاريخ:", fmtDate(m.signDate)));
    body.push(new D.Paragraph({ bidirectional: true, children: [run("التوقيع: ", { bold: true }), sig || run("........................................")] }));

    const doc = new D.Document({
      creator: st.systemName || "نظام محاضر الاجتماعات",
      title: fileName(m),
      styles: { default: { document: { run: { font: FONT, size: 24 } } } },
      sections: [{
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        footers: {
          default: new D.Footer({ children: [new D.Paragraph({ alignment: center, children: [new D.TextRun({ children: [D.PageNumber.CURRENT], font: FONT, size: 20, color: "777777" })] })] }),
        },
        children: body,
      }],
    });
    const blob = await D.Packer.toBlob(doc);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName(m) + ".docx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  window.MinutesDoc = { html, pdf, word, fmtDate, dayName, esc };
})();
