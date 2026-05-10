import LandingHeader from "./Section/LandingHeader";
import Hero from "./Section/Hero";
import Features from "./Section/Features";
import HowItWorksSection from "./Section/HowItWorksSection";
import LearnWhileYouCleanSection from "./Section/LearnWhileYouClean";
import FooterSection from "./Section/Footer";
function LandingPage() {
  return (
    <>
      <LandingHeader />
      <Hero />
      <Features />
      <HowItWorksSection />
      <LearnWhileYouCleanSection />
      <FooterSection />
    </>
  );
}

export default LandingPage;
