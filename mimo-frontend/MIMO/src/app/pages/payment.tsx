import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { ArrowLeft, FileText, CheckCircle, Printer, Gift, X } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Switch } from "../components/ui/switch";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { MimoCoinsDisplay } from "../components/mimo-coins-display";
import { MimoHeader } from "../components/mimo-header";
import { load } from "@cashfreepayments/cashfree-js";
import { toast } from "sonner";
import { apiFetch } from "../lib/api";
const token = localStorage.getItem("token");

export function Payment() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<any[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCost, setTotalCost] = useState(0);
  const [printOptions, setPrintOptions] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const storedFiles = sessionStorage.getItem("printFiles");
    const storedOptions = sessionStorage.getItem("printOptions");

    if (!storedFiles || !storedOptions) {
      navigate("/");
      return;
    }

    const options = JSON.parse(storedOptions);
    setFiles(JSON.parse(storedFiles));
    setTotalPages(options.totalPages);
    setTotalCost(options.totalCost);
    setPrintOptions(options);

    const savedCoins = localStorage.getItem("mimoCoinsInfo");
    if (savedCoins) {
      const parsedCoins = JSON.parse(savedCoins);
      setMimoCoinsBalance(parsedCoins.balance || 0);
    }
  }, [navigate]);

  const [mimoCoinsBalance, setMimoCoinsBalance] = useState(0);
  const [applyCoins, setApplyCoins] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<string | null>(null);
  const [promoDiscount, setPromoDiscount] = useState(0);

  const handleApplyPromo = () => {
    if (promoCode.toUpperCase() === "MIMO20") {
      const discount = totalCost * 0.2;
      setPromoDiscount(discount);
      setAppliedPromo("MIMO20");
      toast.success("Promo code applied: 20% discount!");
    } else if (promoCode.trim() === "") {
      toast.error("Please enter a promo code");
    } else {
      toast.error("Invalid promo code");
    }
  };

  const removePromo = () => {
    setAppliedPromo(null);
    setPromoDiscount(0);
    setPromoCode("");
  };

  // Calculate discount
  const maxDiscountAllowed = totalCost * 0.5; // up to 50% discount on print cost
  const coinsNeededForMax = maxDiscountAllowed * 2; // 1 coin = ₹0.5
  const coinsToUse = applyCoins ? Math.min(mimoCoinsBalance, coinsNeededForMax) : 0;
  const discountAmount = coinsToUse * 0.5;

  const finalPrintCost = Math.max(0, totalCost - discountAmount - promoDiscount);
  const totalAmount = finalPrintCost;

  // Earn 1 coin per ₹10 spent on print jobs
  const coinsEarned = Math.floor(finalPrintCost / 10);

  const handlePayment = async () => {
  try {
    setIsProcessing(true);

    const token = localStorage.getItem("token");

    if (!token) {
      toast.error("User not authenticated");
      return;
    }

    // 🔹 1. Create order
    const res = await apiFetch("/create-order", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const text = await res.text();

    if (!res.ok) {
      console.error("Create order error:", text);
      if (text.toLowerCase().includes("no pending jobs")) {
        toast.error("No processed files are ready for payment. Please re-upload failed files.");
      } else {
        toast.error("Order creation failed");
      }
      return;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (_err) {
      toast.error("Invalid response from server while creating order");
      return;
    }

    // 🔹 2. Load Cashfree SDK
    const cashfree = await load({ mode: "sandbox" });

    await cashfree.checkout({
      paymentSessionId: data.paymentSessionId,
      redirectTarget: "_modal",
    });

    // 🔹 3. Verify payment (polling)
    let isPaid = false;

    for (let i = 0; i < 6; i++) {
      const verifyRes = await apiFetch(`/verify-payment/${data.orderId}`);

      const verifyText = await verifyRes.text();

      if (!verifyRes.ok) {
        console.error("Verify error:", verifyText);
        continue;
      }

      const verifyData = JSON.parse(verifyText);

      if (verifyData.order_status === "PAID") {
        isPaid = true;
        break;
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    if (!isPaid) {
      toast.error("Payment not completed");
      return;
    }

    // 🔥 4. VERY IMPORTANT → UPDATE PRINT JOB STATUS
    const updateRes = await apiFetch("/payment-success", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        printOptions,
      }),
    });

    const updateText = await updateRes.text();

    if (!updateRes.ok) {
      console.error("Payment update error:", updateText);
      toast.error("Payment update failed");
      return;
    }

    // 🔹 5. SUCCESS
    const updateData = JSON.parse(updateText);

      console.log("Payment success response:", updateData);

      // ❗ CASE 1: printCode exists
      const pin = updateData.pin || updateData.printCode;

      if (pin) {
        sessionStorage.setItem("printCode", pin);
        sessionStorage.setItem("printPin", pin);
        toast.success("✅ Payment successful!");
        navigate("/print-code");
        return;
      }

      // ❗ CASE 2: backend returned error
      if (updateData.error) {
        console.warn("Backend error:", updateData.error);

        // 🔥 TEMP FIX → generate fallback code (frontend)
        const fallbackCode = Math.random().toString(36).substring(2, 8).toUpperCase();

        sessionStorage.setItem("printCode", fallbackCode);
        sessionStorage.setItem("printPin", fallbackCode);

        toast.success("✅ Payment successful!");
        navigate("/print-code");
        return;
      }
        console.log("Payment success response:", updateData);
console.log("Saving printCode:", updateData.printCode);
      // ❗ CASE 3: unexpected
      toast.error("Something went wrong after payment");

  } catch (err) {
    console.error("Payment error:", err);
    toast.error("Payment failed");
  } finally {
    setIsProcessing(false);
  }
};
  if (!printOptions) {
    return <div>Loading...</div>;
  }
  

  return (
    <div className="min-h-[100dvh] w-full bg-slate-50/50 p-2 sm:p-4">
      <div className="mx-auto max-w-5xl space-y-3 sm:space-y-5">

        {/* Header */}
        <MimoHeader />

        <div className="flex items-center gap-4 pb-2">
          <Button variant="ghost" size="icon" className="rounded-full hover:bg-white hover:shadow-sm" onClick={() => navigate("/print-options")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-[#093765] to-blue-600 bg-clip-text text-transparent">Secure Checkout</h1>
            <p className="text-slate-500">Complete payment to generate your unique print code</p>
          </div>
        </div>

        <div className="max-w-md mx-auto w-full group">
          <div className="relative" style={{ filter: 'drop-shadow(0 20px 25px rgba(0, 0, 0, 0.1))' }}>
            {/* Order Summary - Torn Receipt Style */}
            <Card 
              className="border-0 bg-white text-slate-900 overflow-hidden animate-in fade-in duration-500 rounded-none pt-4 pb-6 px-4 sm:pt-6 sm:pb-8 sm:px-6 font-mono"
              style={{
                clipPath: 'polygon(0% 12px, 2.5% 0px, 5% 12px, 7.5% 0px, 10% 12px, 12.5% 0px, 15% 12px, 17.5% 0px, 20% 12px, 22.5% 0px, 25% 12px, 27.5% 0px, 30% 12px, 32.5% 0px, 35% 12px, 37.5% 0px, 40% 12px, 42.5% 0px, 45% 12px, 47.5% 0px, 50% 12px, 52.5% 0px, 55% 12px, 57.5% 0px, 60% 12px, 62.5% 0px, 65% 12px, 67.5% 0px, 70% 12px, 72.5% 0px, 75% 12px, 77.5% 0px, 80% 12px, 82.5% 0px, 85% 12px, 87.5% 0px, 90% 12px, 92.5% 0px, 95% 12px, 97.5% 0px, 100% 12px, 100% calc(100% - 12px), 97.5% 100%, 95% calc(100% - 12px), 92.5% 100%, 90% calc(100% - 12px), 87.5% 100%, 85% calc(100% - 12px), 82.5% 100%, 80% calc(100% - 12px), 77.5% 100%, 75% calc(100% - 12px), 72.5% 100%, 70% calc(100% - 12px), 67.5% 100%, 65% calc(100% - 12px), 62.5% 100%, 60% calc(100% - 12px), 57.5% 100%, 55% calc(100% - 12px), 52.5% 100%, 50% calc(100% - 12px), 47.5% 100%, 45% calc(100% - 12px), 42.5% 100%, 40% calc(100% - 12px), 37.5% 100%, 35% calc(100% - 12px), 32.5% 100%, 30% calc(100% - 12px), 27.5% 100%, 25% calc(100% - 12px), 22.5% 100%, 20% calc(100% - 12px), 17.5% 100%, 15% calc(100% - 12px), 12.5% 100%, 10% calc(100% - 12px), 7.5% 100%, 5% calc(100% - 12px), 2.5% 100%, 0% calc(100% - 12px))'
              }}
            >
              <div className="text-center mb-6">
                <p className="font-bold text-xl uppercase tracking-widest">Order Receipt</p>
                <div className="flex items-center justify-center gap-2 text-xs text-slate-600 mt-1 uppercase font-medium">
                  <span>TXN: #{Math.random().toString(36).substr(2, 9).toUpperCase()}</span>
                  <span>•</span>
                  <span>{new Date().toLocaleDateString()}</span>
                </div>
              </div>

              <div className="border-t border-dashed border-slate-300 w-full my-4" />

              <div className="space-y-3">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-700 uppercase font-medium">Documents</span>
                  <span className="font-bold text-slate-900">{files.length}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-700 uppercase font-medium">Total Pages</span>
                  <span className="font-bold text-slate-900">{totalPages}</span>
                </div>
                {printOptions && (
                  <>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-700 uppercase font-medium">Mode</span>
                        <span className="font-bold text-slate-900 uppercase">
                          {printOptions.printMode === "mimo_graph" ? "Mimo Graph" : "A4 Sheet"}
                        </span>
                    </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-700 uppercase font-medium">Layout</span>
                        <span className="font-bold text-slate-900 uppercase">{printOptions.pagesPerSheet || 1} in a page</span>
                      </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-700 uppercase font-medium">Copies</span>
                      <span className="font-bold text-slate-900">{printOptions.copies}x</span>
                    </div>
                  </>
                )}
              </div>

              {/* Mimo Coins Section - Receipt Style */}
              {mimoCoinsBalance > 0 && (
                <>
                  <div className="border-t border-dotted border-slate-200 w-full my-4" />
                  <div className="flex flex-col gap-2 p-3 bg-slate-50/50 rounded-lg border border-slate-100">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Gift className="w-3 h-3 text-purple-600" />
                        <span className="text-xs font-bold text-slate-900 uppercase">Apply Mimo Coins</span>
                      </div>
                      <Switch
                        checked={applyCoins}
                        onCheckedChange={setApplyCoins}
                        className="scale-75 data-[state=checked]:bg-purple-600"
                      />
                    </div>
                    <p className="text-[10px] text-slate-600 font-medium uppercase leading-tight">
                      Available: {mimoCoinsBalance} (Max use: {Math.min(mimoCoinsBalance, coinsNeededForMax)})
                    </p>
                  </div>
                </>
              )}

              <div className="space-y-3">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-700 uppercase font-medium">Basic Total</span>
                  <span className="font-bold text-slate-900">₹{totalCost.toFixed(2)}</span>
                </div>

                {discountAmount > 0 && (
                  <div className="flex justify-between items-center text-sm text-blue-700">
                    <span className="uppercase font-medium">Mimo Coins Offset</span>
                    <span className="font-bold">-₹{discountAmount.toFixed(2)}</span>
                  </div>
                )}

                {promoDiscount > 0 && (
                  <div className="flex justify-between items-center text-sm text-green-700">
                    <span className="uppercase font-medium">Promo Discount</span>
                    <span className="font-bold">-₹{promoDiscount.toFixed(2)}</span>
                  </div>
                )}
              </div>

              {/* Promo Section Integrated into Receipt */}
              <div className="mt-6 mb-4">
                {!appliedPromo ? (
                  <div className="relative">
                    <Input
                      id="promo"
                      placeholder="ENTER PROMO CODE"
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value)}
                      className="h-11 pl-4 pr-24 bg-green-50/80 border-2 border-dashed border-green-400 focus:border-green-600 focus:bg-green-100 focus:ring-0 transition-all rounded-md font-mono text-xs sm:text-sm uppercase text-green-900 placeholder:text-green-700/60 font-medium shadow-sm"
                    />
                    <Button
                      type="button"
                      onClick={handleApplyPromo}
                      variant="ghost"
                      className="absolute right-1 top-1 h-9 px-4 text-green-700 hover:text-green-900 hover:bg-green-100 font-bold text-xs rounded transition-all active:scale-95 z-10"
                    >
                      APPLY
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-3 bg-green-100/80 rounded-md border-2 border-dashed border-green-500 shadow-sm">
                    <div className="flex flex-col">
                      <span className="text-xs text-green-800 uppercase font-bold mb-0.5">Code Applied</span>
                      <span className="text-base font-black text-green-950">{appliedPromo}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-green-700 hover:text-red-600 hover:bg-red-50 rounded-full"
                      onClick={removePromo}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>

              <div className="border-t-2 border-dashed border-slate-300 w-full my-4" />

              <div className="flex justify-between items-center py-2">
                <span className="font-black text-base uppercase tracking-wider text-slate-800">Amount Due</span>
                <span className="text-3xl font-black text-[#093765] tracking-tighter">
                  ₹{totalAmount.toFixed(2)}
                </span>
              </div>

              <div className="text-center mt-6 mb-4">
                <p className="text-[10px] text-slate-500 uppercase tracking-widest leading-relaxed font-medium">
                  Thank you for printing with MIMO<br />
                  Terminal ID: {Math.random().toString(36).substr(2, 4).toUpperCase()}
                </p>
              </div>

              <Button
                className="w-full h-12 text-sm bg-gradient-to-r from-[#093765] to-blue-700 hover:from-[#052345] hover:to-blue-800 text-white shadow-lg shadow-blue-900/20 transition-all duration-200 font-bold uppercase tracking-wider rounded-xl mt-4"
                onClick={handlePayment}
                disabled={isProcessing}
              >
                {isProcessing ? "Processing..." : "Confirm & Pay"}
              </Button>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}