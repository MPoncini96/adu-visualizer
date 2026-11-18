// Receives a quote request and forwards it by email.
// The destination address lives only in the QUOTE_TO_EMAIL environment variable.
// Delivery uses Resend (resend.com) with RESEND_API_KEY. Until a sending domain is
// verified in Resend, the sender is onboarding@resend.dev, which can only deliver to
// the email address the Resend account was created with (set QUOTE_TO_EMAIL to that).
// Once 209adus.com is verified there, set QUOTE_FROM_EMAIL, e.g. "Valley ADU Studio <leads@209adus.com>".
// (FormSubmit was dropped 2026-11-17: its Cloudflare bot check returns 403 to Vercel servers.)

const clean = (v, max = 300) => String(v ?? "").replace(/[<>]/g, "").trim().slice(0, max);

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const name = clean(body.name, 120);
  const phone = clean(body.phone, 40);
  const email = clean(body.email, 160);
  if (!name || (!phone && !email)) {
    return Response.json({ error: "Please add your name and a phone number or email." }, { status: 400 });
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: "That email address doesn't look right." }, { status: 400 });
  }
  if (body.website) return Response.json({ ok: true }); // honeypot

  const lead = {
    Name: name,
    Phone: phone || "-",
    Email: email || "-",
    Address: clean(body.address) || "-",
    Project: clean(body.projectType, 80) || "-",
    Timeline: clean(body.timeline, 60) || "-",
    Model: clean(body.model) || "-",
    Style: clean(body.style) || "-",
    Placement: clean(body.placement) || "-",
    "Closest property line": clean(body.clearance) || "-",
    Location: body.lat && body.lng ? `https://maps.google.com/?q=${Number(body.lat)},${Number(body.lng)}` : "-",
    Notes: clean(body.notes, 1500) || "-",
    Source: clean(body.source, 40) || "site",
  };

  const to = process.env.QUOTE_TO_EMAIL;
  if (!to) {
    console.log("Quote request (QUOTE_TO_EMAIL not set):", lead);
    return Response.json({ ok: true, delivered: false });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("Quote request NOT emailed (RESEND_API_KEY not set):", lead);
    return Response.json({ error: "We couldn't send that right now. Please call or try again later." }, { status: 503 });
  }

  const subject = `New ADU lead: ${lead.Name} (${lead.Project !== "-" ? lead.Project : lead.Model})`;
  const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const rows = Object.entries(lead)
    .map(([k, v]) => {
      const val = /^https?:\/\//.test(v) ? `<a href="${esc(v)}">${esc(v)}</a>` : esc(v).replace(/\n/g, "<br>");
      return `<tr><td style="padding:6px 12px;border:1px solid #ddd;background:#f6f6f6;font-weight:600;white-space:nowrap">${esc(k)}</td><td style="padding:6px 12px;border:1px solid #ddd">${val}</td></tr>`;
    })
    .join("");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px"><h2 style="margin:0 0 12px">${esc(subject)}</h2><table style="border-collapse:collapse">${rows}</table></div>`;
  const text = Object.entries(lead).map(([k, v]) => `${k}: ${v}`).join("\n");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.QUOTE_FROM_EMAIL || "Valley ADU Studio <onboarding@resend.dev>",
        to: to.split(",").map((s) => s.trim()).filter(Boolean),
        ...(email ? { reply_to: email } : {}),
        subject,
        html,
        text,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const out = await res.text();
    if (!res.ok) throw new Error(`Resend ${res.status}: ${out.slice(0, 300)}`);
    return Response.json({ ok: true, delivered: true });
  } catch (e) {
    console.error("Quote delivery failed", e, lead);
    return Response.json({ error: "We couldn't send that right now. Please try again." }, { status: 502 });
  }
}
