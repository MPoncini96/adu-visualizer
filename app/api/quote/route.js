// Receives a quote request and forwards it by email.
// The destination address lives only in the QUOTE_TO_EMAIL environment variable.
// Delivery uses FormSubmit (formsubmit.co): the very first request sends a one-time
// activation email to that address, which must be confirmed before requests arrive.

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
    Model: clean(body.model) || "-",
    Style: clean(body.style) || "-",
    Placement: clean(body.placement) || "-",
    "Closest property line": clean(body.clearance) || "-",
    Location: body.lat && body.lng ? `https://maps.google.com/?q=${Number(body.lat)},${Number(body.lng)}` : "-",
    Notes: clean(body.notes, 1500) || "-",
  };

  const to = process.env.QUOTE_TO_EMAIL;
  if (!to) {
    console.log("Quote request (QUOTE_TO_EMAIL not set):", lead);
    return Response.json({ ok: true, delivered: false });
  }

  try {
    const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(to)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        _subject: `New ADU quote request: ${lead.Name} (${lead.Model})`,
        _template: "table",
        _captcha: "false",
        ...lead,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`FormSubmit ${res.status}`);
    return Response.json({ ok: true, delivered: true });
  } catch (e) {
    console.error("Quote delivery failed", e, lead);
    return Response.json({ error: "We couldn't send that right now. Please try again." }, { status: 502 });
  }
}
