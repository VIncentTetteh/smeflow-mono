import type { Metadata } from 'next';
import { FAQ } from '@/components/marketing/FAQ';
import { FeatureLedger } from '@/components/marketing/FeatureLedger';
import { FinalCTA } from '@/components/marketing/FinalCTA';
import { Footer } from '@/components/marketing/Footer';
import { Hero } from '@/components/marketing/Hero';
import { HowItWorks } from '@/components/marketing/HowItWorks';
import { Nav } from '@/components/marketing/Nav';
import { PricingStubs } from '@/components/marketing/PricingStubs';
import { YensemSpotlight } from '@/components/marketing/YensemSpotlight';
import './marketing.css';

const TITLE = 'SMEflow — Run your business from your phone';
const DESCRIPTION =
  'SMEflow replaces the exercise book for Ghanaian SMEs: point of sale, inventory, MoMo & GhQR payments, a multilingual AI assistant, invoicing, tax, and credit — free to start.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: 'SMEflow',
    locale: 'en_GH',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function Home() {
  return (
    <div className="sf-marketing">
      <Nav />
      <Hero />
      <FeatureLedger />
      <YensemSpotlight />
      <HowItWorks />
      <PricingStubs />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  );
}
