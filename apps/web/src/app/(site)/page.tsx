import { RequestFlow } from '@/components/flow/RequestFlow';
import { ExampleReview } from '@/components/landing/ExampleReview';
import { ReportStill } from '@/components/report/ReportStill';
import '@/components/report/report-still.css';
import { Features } from '@/components/landing/Features';
import { Hero } from '@/components/landing/Hero';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { NetWave } from '@/components/landing/NetWave';
import { Now } from '@/components/landing/Now';
import { Pricing } from '@/components/landing/Pricing';
import { Roadmap } from '@/components/landing/Roadmap';
import { Trust } from '@/components/landing/Trust';
import '@/design/css/landing.css';

export default function HomePage() {
  return (
    <div className="bleed land">
      <NetWave />
      <Hero />
      <Features />
      <HowItWorks />
      <ExampleReview />
      <section className="land-section" id="report-preview" aria-labelledby="report-preview-title">
        <div className="container-wide">
          <header className="land-head">
            <p className="land-kicker"><span className="eyebrow">Published report</span></p>
            <h2 id="report-preview-title" className="h2">A report you can open</h2>
            <p className="lede">A full page from the bundled sample. Click it. The page turns to the finding.</p>
          </header>
          <ReportStill />
        </div>
      </section>
      <Now />
      <Roadmap />
      <Trust />
      <Pricing />
      <div className="land-section">
        <div className="container-wide review-center">
          <RequestFlow />
        </div>
      </div>
    </div>
  );
}
