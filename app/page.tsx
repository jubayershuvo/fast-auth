import type { Metadata } from "next";

import { LandingPage } from "@/components/landing/landing-page";

export const metadata: Metadata = {
  title: "FastAuth — License & Authentication Platform",
};

export default function Home() {
  return <LandingPage />;
}
