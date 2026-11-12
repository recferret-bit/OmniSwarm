import { ExampleReview } from '@/components/landing/ExampleReview';
import { ReportStill } from '@/components/report/ReportStill';
import '@/components/report/report-still.css';
import { Features } from '@/components/landing/Features';
import { GetStarted } from '@/components/landing/GetStarted';
import { Hero } from '@/components/landing/Hero';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { NetWave } from '@/components/landing/NetWave';
import { Now } from '@/components/landing/Now';
import { Roadmap } from '@/components/landing/Roadmap';
import { Trust } from '@/components/landing/Trust';
import { Donate } from '@/components/support/Donate';
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
      <GetStarted />
      {/* Optional support, always last. Renders nothing until NEXT_PUBLIC_DONATION_ACCOUNT is set. */}
      <Donate />
    </div>
  );
}
