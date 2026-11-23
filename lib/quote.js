// Sends a quote request by email through FormSubmit (formsubmit.co), straight from the browser.
// The site is static (GitHub Pages), so there is no server to hide the address in.
// NEXT_PUBLIC_QUOTE_FORM_ID should be the random alias FormSubmit emails you after the
// first submission is confirmed, so the real inbox address never appears in the page.
// The very first request sends a one-time activation email that must be confirmed.

const FORM_ID = process.env.NEXT_PUBLIC_QUOTE_FORM_ID;

const clean = (v, max = 300) => String(v ?? "").replace(/[<>]/g, "").trim().slice(0, max);

export async function sendQuote(body) {
  const name = clean(body.name, 120);
  const phone = clean(body.phone, 40);
  const email = clean(body.email, 160);
  if (!name || (!phone && !email)) throw new Error("Please add your name and a phone number or email.");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That email address doesn't look right.");
  if (body.website) return { ok: true }; // honeypot

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

  if (!FORM_ID) {
    console.log("Quote request (NEXT_PUBLIC_QUOTE_FORM_ID not set):", lead);
    return { ok: true, delivered: false };
  }

  let res;
  try {
    res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(FORM_ID)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        _subject: `New ADU lead: ${lead.Name} (${lead.Project !== "-" ? lead.Project : lead.Model})`,
        _template: "table",
        _captcha: "false",
        ...(email ? { _replyto: email } : {}),
        ...lead,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error("We couldn't send that right now. Please try again.");
  }
  const data = await res.json().catch(() => ({}));
  // FormSubmit answers 200 with success "false" for some failures (e.g. not yet activated)
  if (!res.ok || String(data.success) === "false") {
    console.error("Quote delivery failed", res.status, data, lead);
    throw new Error("We couldn't send that right now. Please try again.");
  }
  return { ok: true, delivered: true };
}
