// Home page: built to turn visitors into consultation requests. The lead form sits in the hero;
// everything below either answers a question that stops people from asking, or sends them back to it.
import Link from "next/link";
import { MODELS, heightLabel } from "../lib/models.js";
import { SITE, CITIES } from "../lib/site.js";
import PlanThumb from "./PlanThumb.jsx";
import LeadForm from "./LeadForm.jsx";
import LeadButton from "./LeadButton.jsx";
import StickyLeadBar from "./StickyLeadBar.jsx";

const FEATURED = ["cherry", "plum", "almond"];

const USES = [
  { type: "backyard", title: "Rental income", text: "A one-bedroom in the back yard can bring in steady monthly rent while you keep the main house." },
  { type: "backyard", title: "Room for family", text: "Keep aging parents close, give grown kids a place of their own, or host guests without giving up your space." },
  { type: "farm", title: "Farm worker housing", text: "Housing for workers on agricultural property, sized for a crew or a family. We check what your county and parcel allow." },
  { type: "garage", title: "Garage conversion", text: "Turn a two-car garage into a one-bedroom unit. No new footprint in the yard, and often the lowest-cost option." },
];

export const FAQ = [
  {
    q: "Can I build an ADU on my property?",
    a: "Most likely. California law allows an ADU on most lots that have a single-family home, and many lots can add a junior ADU as well. Your city or county still sets details like height, setbacks and utility hookups, so we check those for your exact address during the free consultation.",
  },
  {
    q: "How much does an ADU cost in the Central Valley?",
    a: "It depends mostly on size, site work (how far utilities have to run, grading, access) and finishes. Garage conversions usually cost the least; a detached two-bedroom costs the most. After the consultation we give you a written estimate for your lot, not a range off a website.",
  },
  {
    q: "How long does it take?",
    a: "It varies by city and plan. Permits can take anywhere from several weeks to a few months, and construction usually takes several months after that. We'll give you a timeline for your property up front.",
  },
  {
    q: "Can I put housing for farm workers on my land?",
    a: "Often, yes. Agricultural parcels can usually add worker housing, but the rules depend on your county's zoning and California's employee housing requirements. Tell us where the property is and we'll find out what it allows.",
  },
  {
    q: "Do you handle the plans and permits?",
    a: "Yes. We prepare the plans, submit them to your city or county, answer their comments and build the unit, so you have one team from the first visit to move-in.",
  },
  {
    q: "What areas do you serve?",
    a: `${SITE.area}, about 40 miles either side, including ${CITIES.slice(0, -1).join(", ")} and ${CITIES.at(-1)}.`,
  },
];

export default function Landing() {
  return (
    <main className="landing">
      <section className="hero hero-lead">
        <div className="hero-copy">
          <p className="eyebrow">ADUs and farm worker housing · {SITE.area}</p>
          <h1>Thinking about an ADU? Find out what you can build, free.</h1>
          <p className="hero-lede">
            Tell us about your property. We'll check what your lot allows, suggest a plan that fits, and give you a price and timeline. No cost and no obligation.
          </p>
          <ul className="hero-checks">
            <li>Free lot, zoning and permit check</li>
            <li>Plans from 240 to 1,108 sq ft, plus garage conversions</li>
            <li>For renters, family or farm workers</li>
            <li>One team for design, permits and construction</li>
          </ul>
          <img className="hero-photo" src="/landing/adu-hero.jpg" alt="A detached backyard ADU with red siding behind the main house" width={1600} height={1000} />
        </div>
        <div id="get-started" className="hero-form">
          <LeadForm source="home-hero" />
        </div>
      </section>

      <section className="uses" aria-labelledby="uses-title">
        <h2 id="uses-title">What people build</h2>
        <div className="uses-grid">
          {USES.map((u) => (
            <article key={u.title} className="use-card">
              <h3>{u.title}</h3>
              <p>{u.text}</p>
              <LeadButton projectType={u.type} className="link-btn">Ask about this →</LeadButton>
            </article>
          ))}
        </div>
      </section>

      <section className="how" aria-labelledby="how-title">
        <h2 id="how-title">How it works</h2>
        <ol className="how-4">
          <li><b>Tell us about your property.</b> Two minutes with the form above.</li>
          <li><b>Free consultation.</b> We look at your lot, your city's rules and your utilities, and suggest plans that fit.</li>
          <li><b>Written estimate.</b> A real price and timeline for your property, with no pressure to sign.</li>
          <li><b>Design, permit, build.</b> We handle the plans, the city and the construction through move-in.</li>
        </ol>
        <LeadButton className="btn btn-primary btn-lg">Start with a free consultation</LeadButton>
      </section>

      <section className="lineup" aria-labelledby="plans-title">
        <div className="section-head">
          <h2 id="plans-title">Popular plans</h2>
          <Link href="/walk" className="link-btn">See all 10 plans →</Link>
        </div>
        <div className="lineup-grid">
          {FEATURED.map((id) => {
            const m = MODELS.find((x) => x.id === id);
            return (
              <article key={id} className="plan-tile">
                <div className="plan-tile-fp"><PlanThumb id={id} /></div>
                <div className="plan-tile-body">
                  <h3>{m.name}</h3>
                  <p className="muted">{m.kind} · {m.sqft.toLocaleString()} sq ft · {heightLabel(m)}</p>
                  <p className="plan-tile-blurb">{m.blurb}</p>
                  <div className="plan-tile-actions">
                    <LeadButton plan={m.name} className="btn btn-primary btn-sm">Get pricing</LeadButton>
                    <Link href={`/walk?model=${id}`} className="btn btn-light btn-sm">Walk inside</Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="see-first" aria-labelledby="see-title">
        <div className="section-head">
          <h2 id="see-title">Not ready to talk yet? See it first.</h2>
        </div>
        <div className="tools">
          <ToolCard
            href="/visualizer"
            img="/landing/adu-lot.jpg"
            alt="A fenced back yard behind a house, with room for an ADU"
            title="Try a plan on your lot"
            text="Look up your address, drag a plan into your back yard, and see how it fits next to your house and property line. Then view it in 3D."
            cta="Open the 3D Visualizer"
          />
          <ToolCard
            href="/walk"
            img="/landing/adu-inside.jpg"
            alt="A bright open living room with the dining area and kitchen behind it"
            title="Walk inside"
            text="Step through the front door and walk every room in 3D, furnished, with room sizes. Works on a phone too."
            cta="Start a walk-through"
          />
        </div>
      </section>

      <section className="faq" aria-labelledby="faq-title">
        <h2 id="faq-title">Common questions</h2>
        {FAQ.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </section>

      <section id="final-cta" className="final-cta">
        <h2>See what your lot can hold.</h2>
        <p>A free consultation answers the big questions: can you build, what fits, what it costs and how long it takes.</p>
        <div className="hero-ctas">
          <LeadButton className="btn btn-primary btn-lg">Get my free consultation</LeadButton>
          <Link href="/visualizer" className="btn btn-light btn-lg">Try a plan on my lot</Link>
        </div>
      </section>

      <footer className="site-foot">
        <div>
          <b>{SITE.name}</b> · ADUs, garage conversions and farm worker housing
          <p className="foot-cities">Serving {CITIES.join(" · ")} and nearby, about 40 miles either side of Highway 99.</p>
        </div>
        <span>Plans, layouts and finishes shown are samples. Every design is finalized with you.</span>
      </footer>

      <StickyLeadBar />
    </main>
  );
}

function ToolCard({ href, img, alt, title, text, cta }) {
  return (
    <Link href={href} className="tool-card">
      <img src={img} alt={alt} width={1200} height={750} loading="lazy" />
      <div className="tool-card-body">
        <h3>{title}</h3>
        <p>{text}</p>
        <span className="tool-cta">{cta} →</span>
      </div>
    </Link>
  );
}
