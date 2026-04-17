import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { Toaster } from "./app/components/ui/sonner";
import { Login } from "./app/pages/login";
import { UploadFile } from "./app/pages/upload-file";
import { PrintOptions } from "./app/pages/print-options";
import { Payment } from "./app/pages/payment";
import { PrintCode } from "./app/pages/print-code";
import { UserProfile } from "./app/pages/user-profile";
import { PrinterSettings } from "./app/pages/printer-settings";
import { OnboardingName } from "./app/pages/onboarding-name";
import { PrintHistory } from "./app/pages/print-history";



export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/upload" element={<UploadFile />} />
        <Route path="/print-options" element={<PrintOptions />} />
        <Route path="/payment" element={<Payment />} />
        <Route path="/print-code" element={<PrintCode />} />
        <Route path="/user-profile" element={<UserProfile />} />
        <Route path="/settings" element={<PrinterSettings />} />
        <Route path="/onboarding" element={<OnboardingName />} />
        <Route path="/history" element={<PrintHistory />} />
      </Routes>
      <Toaster />
      <Analytics />
      <SpeedInsights />
    </BrowserRouter>
  );
}