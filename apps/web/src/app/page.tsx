import { RequestFlow } from '@/components/flow/RequestFlow';
import { Hero } from '@/components/landing/Hero';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { Pricing } from '@/components/landing/Pricing';
import { Trust } from '@/components/landing/Trust';

export default function HomePage() {
  return (
    <>
      <Hero />
      <RequestFlow />
      <HowItWorks />
      <Trust />
      <Pricing />
    </>
  );
}
