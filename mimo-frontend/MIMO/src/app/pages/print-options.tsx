import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { MimoHeader } from "../components/mimo-header";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { ArrowLeft, FileText, Minus, Plus, Eye } from "lucide-react";

interface UploadedFile {
  name: string;
  size: number;
  pageCount?: number;
  previewUrl?: string;
}

export function PrintOptions() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [copies, setCopies] = useState(1);
  const [colorMode, setColorMode] = useState("bw");
  const [doubleSided, setDoubleSided] = useState("single");
  const [pageSelection, setPageSelection] = useState("all");
  const [pageRange, setPageRange] = useState("");
  const [orientation, setOrientation] = useState("portrait");
  const [selectedPreview, setSelectedPreview] = useState<number | null>(null);

  const [backendSummary, setBackendSummary] = useState<{
    totalPages: number;
    amount: number;
  } | null>(null);

  useEffect(() => {
    const storedFiles = sessionStorage.getItem("printFiles");
    const summary = sessionStorage.getItem("printSummary");

    if (!storedFiles || !summary) {
      navigate("/");
      return;
    }

    setFiles(JSON.parse(storedFiles));

    const parsedSummary = JSON.parse(summary);
    setBackendSummary({
      totalPages: parsedSummary?.totalPages ?? parsedSummary?.estimatedPages ?? 0,
      amount: parsedSummary?.amount ?? parsedSummary?.estimatedAmount ?? 0,
    });
  }, [navigate]);

  // ✅ REAL DATA FROM BACKEND
  const totalPages = backendSummary?.totalPages || 0;

  const actualPages =
    doubleSided === "double"
      ? Math.ceil(totalPages / 2)
      : totalPages;

  // ✅ BACKEND PRICING FIX
  const backendAmount = backendSummary?.amount || 0;

  const adjustedAmount =
    doubleSided === "double"
      ? backendAmount / 2
      : backendAmount;

  const totalCost = adjustedAmount * copies;

  // ✅ dynamic price per page (for display only)
  const pricePerPage =
    totalPages > 0 ? backendAmount / totalPages : 0;

  const handleContinue = () => {
    sessionStorage.setItem(
      "printOptions",
      JSON.stringify({
        copies,
        colorMode,
        doubleSided,
        pageSelection,
        pageRange,
        orientation,
        totalPages: actualPages * copies,
        totalCost,
      })
    );

    navigate("/payment");
  };

  const incrementCopies = () => {
    if (copies < 99) setCopies(copies + 1);
  };

  const decrementCopies = () => {
    if (copies > 1) setCopies(copies - 1);
  };

  return (
    <div className="min-h-[100dvh] w-full bg-slate-50/50 p-2 sm:p-4">
      <div className="mx-auto max-w-6xl space-y-3 sm:space-y-5">

        <MimoHeader />

        <div className="flex items-center gap-4 pb-2">
          <Button variant="ghost" size="icon" className="rounded-full hover:bg-white hover:shadow-sm" onClick={() => navigate("/upload")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-[#093765] to-blue-600 bg-clip-text text-transparent">Print Configuration</h1>
            <p className="text-slate-500">Customize how you want your documents to look</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">

          {/* LEFT */}
          <div className="lg:col-span-2 space-y-3 sm:space-y-4">

            {/* Copies */}
            <Card className="border-0 shadow-sm bg-white/80 backdrop-blur p-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-slate-800">Number of Copies</p>
                </div>
                <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-xl border">
                  <Button size="icon" onClick={decrementCopies} disabled={copies <= 1}>
                    <Minus className="w-3 h-3" />
                  </Button>
                  <span className="w-8 text-center text-sm font-black">{copies}</span>
                  <Button size="icon" onClick={incrementCopies} disabled={copies >= 99}>
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </Card>

            {/* Color */}
            <Card>
              <CardHeader>
                <CardTitle>Color Mode</CardTitle>
              </CardHeader>
              <CardContent>
                <RadioGroup value={colorMode} onValueChange={setColorMode}>
                  <div className="p-4 border rounded-xl">
                    <RadioGroupItem value="bw" id="bw" />
                    <Label htmlFor="bw">Black & White</Label>
                    <span className="float-right">₹{pricePerPage.toFixed(2)}/page</span>
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>

            {/* Layout */}
            <Card className="p-3">
              <div className="flex justify-between">
                <p>Print Layout</p>
                <div>
                  <button onClick={() => setDoubleSided("single")}>1-Sided</button>
                  <button onClick={() => setDoubleSided("double")}>2-Sided</button>
                </div>
              </div>
            </Card>

            {/* Files */}
            <Card>
              <CardHeader>
                <CardTitle>Document Preview</CardTitle>
              </CardHeader>
              <CardContent>
                {files.map((file, index) => {
                  const ext = file.name.split(".").pop()?.toLowerCase() || "";
                  const canPreview = ["pdf", "jpg", "jpeg", "png", "txt"].includes(ext) && !!file.previewUrl;
                  return (
                    <div key={index} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate">{file.name}</p>
                        <p className="text-xs text-slate-500">{file.pageCount || 0} pages</p>
                      </div>
                      <Button
                        size="icon"
                        variant="outline"
                        disabled={!canPreview}
                        onClick={() => canPreview && window.open(file.previewUrl, "_blank", "noopener,noreferrer")}
                        title={canPreview ? "Preview file" : "Preview available for PDF, TXT, and images"}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

          </div>

          {/* RIGHT */}
          <div>
            <Card className="bg-black text-white p-6 rounded-2xl">
              <p>Documents: {files.length}</p>
              <p>Total Pages: {totalPages}</p>
              <p>Copies: {copies}</p>

              <hr className="my-3"/>

              <p>Price/Page: ₹{pricePerPage.toFixed(2)}</p>
              <p>Total Sheets: {actualPages * copies}</p>

              <hr className="my-3"/>

              <h2 className="text-2xl font-bold">₹{totalCost.toFixed(2)}</h2>

              <Button onClick={handleContinue} className="w-full mt-4">
                Continue
              </Button>
            </Card>
          </div>

        </div>
      </div>
    </div>
  );
}