import { createFileRoute } from '@tanstack/react-router';
import { OnboardingPage } from '../features/onboarding/OnboardingPage';

/** First-run setup, full window (outside the app shell). */
export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
});
