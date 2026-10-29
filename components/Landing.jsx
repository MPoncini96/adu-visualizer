"use client";
// Home page: what the studio does, the two tools, and the plan lineup.
import Link from "next/link";
import { MODELS, heightLabel } from "../lib/models.js";
import { floorPlanFor } from "../lib/floorplans/index.js";
import FloorPlanSVG from "./FloorPlanSVG.jsx";

const FEATURED = ["cherry", "plum", "almond"];

export default function Landing() {
  return (
    <main className="landing">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Backyard ADUs for the San Joaquin Valley</p>
          <h1>See your ADU before anyone breaks ground.</h1>
          <p className="hero-lede">
            Walk through our plans room by room, then drop one onto your own lot to check the fit. Free, in your browser, no appointment needed.
          </p>
          <div className="hero-ctas">
            <Link href="/walk" className="btn btn-primary btn-lg">Walk inside a plan</Link>
            <Link href="/visualizer" className="btn btn-light btn-lg">Try one on my lot</Link>
          </div>
          <ul className="hero-facts">
            <li><b>10</b> plans, 240 to 1,108 sq ft</li>
            <li><b>3</b> exterior styles</li>
            <li>Lodi to Fresno along Hwy 99</li>
          </ul>
        </div>
        <div className="hero-art">
          <img src="/landing/hero-exterior.jpg" alt="The Peach ADU in Tan Craftsman, seen from the back yard" width={1600} height={1000} />
        </div>
      </section>

      <section className="tools" aria-label="Tools">
        <ToolCard
          href="/walk"
          img="/landing/walk-inside.jpg"
          alt="Inside The Almond: living room looking toward the dining area"
          title="Walk inside"
          text="Step through the front door and walk every room in 3D, furnished, with room sizes. Works on a phone too: left thumb to walk, drag to look."
          cta="Start a walk-through"
        />
        <ToolCard
          href="/visualizer"
          img="/landing/visualizer.jpg"
          alt="Site plan of an example lot in Manteca with an ADU placed in the back yard"
          title="3D Visualizer"
          text="Look up your address, drag a plan into your back yard, and see how it sits against the property line and your house. Then view it in 3D or stand in it with AR."
          cta="Plan it on my lot"
        />
      </section>

      <section className="lineup">
        <div className="section-head">
          <h2>Popular plans</h2>
          <Link href="/walk" className="link-btn">See all 10 plans →</Link>
        </div>
        <div className="lineup-grid">
          {FEATURED.map((id) => {
            const m = MODELS.find((x) => x.id === id);
            return (
              <article key={id} className="plan-tile">
                <div className="plan-tile-fp"><FloorPlanSVG plan={floorPlanFor(id)} model={m} labels furniture={false} /></div>
                <div className="plan-tile-body">
                  <h3>{m.name}</h3>
                  <p className="muted">{m.kind} · {m.sqft.toLocaleString()} sq ft · {heightLabel(m)}</p>
                  <p className="plan-tile-blurb">{m.blurb}</p>
                  <div className="plan-tile-actions">
                    <Link href={`/walk?model=${id}`} className="btn btn-dark btn-sm">Walk inside</Link>
                    <Link href={`/visualizer?model=${id}`} className="btn btn-light btn-sm">Place on my lot</Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="how">
        <h2>How it works</h2>
        <ol>
          <li><b>Pick a plan.</b> From a 240 sq ft backyard studio to a full two-bed, two-bath home, or a garage conversion.</li>
          <li><b>Try it on your lot.</b> We pull your property lines from county records and check the spacing to your house.</li>
          <li><b>Get a quote.</b> Send us your design and we'll confirm your city's rules and talk through cost and timeline.</li>
        </ol>
      </section>

      <footer className="site-foot">
        <span>Valley ADU Studio · Serving Lodi to Fresno, about 40 miles either side of Highway 99.</span>
        <span>Plans, layouts and finishes shown are samples. The builder finalizes every design.</span>
      </footer>
    </main>
  );
}

function ToolCard({ href, img, alt, title, text, cta }) {
  return (
    <Link href={href} className="tool-card">
      <img src={img} alt={alt} width={1200} height={750} loading="lazy" />
      <div className="tool-card-body">
        <h2>{title}</h2>
        <p>{text}</p>
        <span className="tool-cta">{cta} →</span>
      </div>
    </Link>
  );
}
