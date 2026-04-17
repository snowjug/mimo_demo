import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { MimoCoinsDisplay } from "../components/mimo-coins-display";
import { Upload, FileText, X, Printer, CheckCircle, AlertCircle, History, Layers, Wallet } from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_API_URL || "http://localhost:3000";

const ALLOWED_EXTENSIONS = ["pdf", "doc", "docx", "txt", "jpg", "jpeg", "png"];

const isAllowedFileType = (file: File) => {
  const ext = file.name.split(".").pop()?.toLowerCase();
  return !!ext && ALLOWED_EXTENSIONS.includes(ext);
};

interface UploadedFile {
  name: string;
  size: number;
  status: "uploading" | "completed" | "failed";
  progress: number;
}

export function UploadFile() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [userName, setUserName] = useState("Admin User");
  const [userStats, setUserStats] = useState({ totalDocs: 0, totalPages: 0, totalSpent: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedName = localStorage.getItem("mimo_user_name");
    if (savedName) {
      setUserName(savedName);
    }
    const savedStats = localStorage.getItem("userStats");
    if (savedStats) {
      setUserStats(JSON.parse(savedStats));
    }
  }, []);

  const handleFileSelect = async (fileList: FileList | null) => {
  if (!fileList) return;

  const selectedFiles = Array.from(fileList).filter((file) => isAllowedFileType(file));

  if (selectedFiles.length === 0) {
    return;
  }

  // keep your UI behavior
  const newFiles: UploadedFile[] = selectedFiles.map((file) => ({
    name: file.name,
    size: file.size,
    status: "uploading",
    progress: 0,
  }));

  setFiles((prev) => [...prev, ...newFiles]);

  try {
    const formData = new FormData();

    selectedFiles.forEach((file) => {
      formData.append("files", file); // ✅ matches backend
    });

    const token = localStorage.getItem("token");

    const res = await fetch(`${API_BASE_URL}/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`, // ✅ important
      },
      body: formData,
    });

    const data = await res.json();

    if (!res.ok) throw new Error("Upload failed");

    // ✅ keep your animation effect
    selectedFiles.forEach((_, index) => {
      const actualIndex = files.length + index;
      let progress = 0;

      const interval = setInterval(() => {
        progress += 20;

        if (progress >= 100) {
          clearInterval(interval);
          setFiles((prev) =>
            prev.map((f, i) =>
              i === actualIndex
                ? { ...f, status: "completed", progress: 100 }
                : f
            )
          );
        } else {
          setFiles((prev) =>
            prev.map((f, i) =>
              i === actualIndex ? { ...f, progress } : f
            )
          );
        }
      }, 150);
    });

    // Normalize keys so downstream pages can rely on totalPages/amount.
    const normalizedSummary = {
      ...data,
      totalPages: data?.totalPages ?? data?.estimatedPages ?? 0,
      amount: data?.amount ?? data?.estimatedAmount ?? 0,
    };

    sessionStorage.setItem("printSummary", JSON.stringify(normalizedSummary));

    console.log("UPLOAD SUCCESS:", normalizedSummary);

  } catch (error) {
    console.error(error);

    setFiles((prev) =>
      prev.map((f, i) =>
        i >= prev.length - selectedFiles.length
          ? { ...f, status: "failed" }
          : f
      )
    );
  }
};

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const totalPages = files.filter((f) => f.status === "completed").length * 5; // Mock calculation

  const handlePrint = () => {
  sessionStorage.setItem(
    "printFiles",
    JSON.stringify(files.filter((f) => f.status === "completed"))
  );

  navigate("/print-options");
};

  return (
    <div className="min-h-[100dvh] w-full bg-slate-50/50 p-2 sm:p-4">
      <div className="mx-auto max-w-5xl space-y-4 sm:space-y-6">

        {/* Global Styles for Custom Fonts */}
        <style>
          {`
            @import url('https://fonts.googleapis.com/css2?family=Caveat+Brush&family=Outfit:wght@400;500;600&family=Chewy&family=Pacifico&display=swap');
            
            @keyframes float-hey {
              0%, 100% { transform: rotate(-10deg) translateY(0px); }
              50% { transform: rotate(-3deg) translateY(-8px); }
            }
          `}
        </style>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col items-start cursor-pointer group select-none ml-2 pt-2">
            <div className="z-20 -mb-2 relative animate-[float-hey_3s_ease-in-out_infinite] hover:rotate-0 hover:scale-[1.15] transition-all duration-300">
              <span
                className="text-[3.5rem] sm:text-[6rem] bg-clip-text text-transparent bg-gradient-to-tr from-[#093765] via-blue-600 to-[#a855f7] leading-none drop-shadow-[0_8px_8px_rgba(9,55,101,0.4)] pr-2"
                style={{ fontFamily: "'Chewy', cursive", letterSpacing: "1px" }}
              >
                HEY!
              </span>
            </div>
            <h1
              className="text-2xl sm:text-5xl font-normal text-gray-900 tracking-tight z-10 -mt-1"
              style={{ fontFamily: "'Outfit', sans-serif" }}
            >
              {userName}
            </h1>
          </div>
          <div className="flex items-center gap-1 sm:gap-3">
            <MimoCoinsDisplay />
            <div className="flex items-center gap-1 sm:gap-3 cursor-pointer p-1 sm:p-2 hover:bg-white/50 rounded-xl transition-colors" onClick={() => navigate("/user-profile")}>
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-gray-700">{userName}</p>
                <p className="text-xs text-gray-500">View Profile</p>
              </div>
              <Avatar className="h-10 w-10 border-2 border-white shadow-sm">
                <AvatarFallback className="bg-gradient-to-br from-[#093765] to-blue-600 text-white">
                  {userName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)}
                </AvatarFallback>
              </Avatar>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-3xl sm:text-4xl font-extrabold bg-gradient-to-r from-[#093765] to-blue-600 bg-clip-text text-transparent animate-in fade-in slide-in-from-left-4 duration-500">Upload Documents</h1>
          <p className="text-base sm:text-lg text-slate-500">Prepare your files for the MIMO printer</p>
        </div>

        {/* Printer Status */}
        <Card className="border-0 shadow-lg bg-gradient-to-br from-[#093765] to-blue-600 text-white overflow-hidden relative group">
          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity pointer-events-none">
            <Printer className="w-32 h-32 rotate-12" />
          </div>
          <CardContent className="p-4 sm:p-6 relative z-10">
            <div className="flex flex-row items-center justify-between gap-3 sm:gap-6">
              <div className="flex-1">
                <div className="flex items-center gap-2 sm:gap-3 mb-1 sm:mb-2">
                  <h3 className="font-bold text-base sm:text-xl">My Dashboard</h3>
                  <Badge className="bg-white/20 hover:bg-white/30 text-white border-0 backdrop-blur-md text-[10px] sm:text-xs">
                    <CheckCircle className="w-3 h-3 mr-1 hidden sm:inline" />
                    Active User
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:gap-4 max-w-md mt-2 sm:mt-4">
                  <div className="bg-white/10 rounded-lg p-1.5 sm:p-2 text-center backdrop-blur-sm">
                    <div className="text-[9px] sm:text-xs opacity-80 flex items-center justify-center gap-1 mb-0.5 sm:mb-1"><History className="w-3 h-3" /> <span className="hidden sm:inline">Printouts</span></div>
                    <div className="font-bold text-xs sm:text-base">{userStats.totalDocs}</div>
                  </div>
                  <div className="bg-white/10 rounded-lg p-1.5 sm:p-2 text-center backdrop-blur-sm">
                    <div className="text-[9px] sm:text-xs opacity-80 flex items-center justify-center gap-1 mb-0.5 sm:mb-1"><Layers className="w-3 h-3" /> <span className="hidden sm:inline">Pages</span></div>
                    <div className="font-bold text-xs sm:text-base">{userStats.totalPages}</div>
                  </div>
                  <div className="bg-white/10 rounded-lg p-1.5 sm:p-2 text-center backdrop-blur-sm">
                    <div className="text-[9px] sm:text-xs opacity-80 flex items-center justify-center gap-1 mb-0.5 sm:mb-1"><Wallet className="w-3 h-3" /> <span className="hidden sm:inline">Spent</span></div>
                    <div className="font-bold text-xs sm:text-base">₹{userStats.totalSpent.toFixed(0)}</div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Upload Area */}
        <Card className="shadow-xl border-0 bg-white/80 backdrop-blur-xl">
          {/* No Header */}
          <CardContent className={files.length > 0 ? "p-3 sm:p-6" : "p-4 sm:p-6"}>
            <div
              className={`border-2 sm:border-3 border-dashed transition-all duration-500 ease-in-out group cursor-pointer ${isDragging
                ? "border-indigo-500 bg-indigo-50/50 scale-[1.02] shadow-xl"
                : "border-gray-200 hover:border-indigo-400 hover:bg-gray-50/80"
                } ${files.length > 0
                  ? "p-4 sm:p-6 rounded-2xl flex flex-col sm:flex-row items-center justify-center gap-4 text-center"
                  : "p-4 sm:p-8 rounded-3xl text-center flex flex-col items-center justify-center"
                }`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              {files.length > 0 ? (
                <>
                  <div className="flex items-center justify-center gap-3">
                    <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all duration-300 ${isDragging ? 'bg-indigo-100' : 'bg-gray-100 group-hover:bg-indigo-50'}`}>
                      <Upload className={`w-5 h-5 sm:w-6 sm:h-6 transition-colors duration-300 ${isDragging ? "text-indigo-600" : "text-gray-500 group-hover:text-indigo-500"}`} />
                    </div>
                    <div className="text-left">
                      <h3 className="text-sm sm:text-base font-semibold text-gray-700">Add more files</h3>
                      <p className="text-xs text-gray-500 hidden sm:block">Support for PDF, DOCX, TXT, and Images</p>
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png"
                    onChange={(e) => handleFileSelect(e.target.files)}
                  />
                </>
              ) : (
                <>
                  <div className={`w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 sm:mb-6 rounded-full flex items-center justify-center transition-all duration-300 ${isDragging ? 'bg-indigo-100' : 'bg-gray-100 group-hover:bg-indigo-50'}`}>
                    <Upload className={`w-8 h-8 sm:w-10 sm:h-10 transition-colors duration-300 ${isDragging ? "text-indigo-600" : "text-gray-400 group-hover:text-indigo-500"}`} />
                  </div>
                  <h3 className="text-lg sm:text-2xl font-semibold mb-2 sm:mb-3 text-gray-700">Drop files to upload</h3>
                  <p className="text-sm sm:text-base text-gray-500 mb-6 sm:mb-8 max-w-md mx-auto px-4">
                    Support for PDF, DOCX, TXT, and Image files. Optimized for fast printing.
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png"
                    onChange={(e) => handleFileSelect(e.target.files)}
                  />
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Uploaded Files */}
        {files.length > 0 && (
          <Card className="border-0 shadow-lg overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-500">
            <CardHeader>
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <CardTitle>Uploaded Files</CardTitle>
                  <CardDescription>
                    {files.filter((f) => f.status === "completed").length} of {files.length} file(s) ready
                  </CardDescription>
                </div>
                {files.some((f) => f.status === "completed") && (
                  <div className="text-left sm:text-right bg-indigo-50 px-4 py-2 rounded-lg w-full sm:w-auto">
                    <p className="text-sm font-medium">Est. pages: {totalPages}</p>
                    <p className="text-xs text-gray-500">Total print time: ~{Math.ceil(totalPages / 10)} mins</p>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-4 p-4 border border-gray-100 rounded-xl bg-white hover:shadow-md transition-all duration-200 group"
                  >
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${file.status === 'completed' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                      <FileText className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        {file.status === "completed" && (
                          <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 whitespace-nowrap text-[10px] sm:text-xs">
                            ~{file.size > 2000000 ? Math.floor(file.size / 500000) : 1} pgs
                          </Badge>
                        )}
                        {file.status === "failed" && (
                          <Badge variant="destructive">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            Failed
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                      {file.status === "uploading" && (
                        <div className="w-full bg-gray-100 rounded-full h-1.5 mt-3 overflow-hidden">
                          <div
                            className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                            style={{ width: `${file.progress}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      className="opacity-100 transition-opacity hover:bg-red-50 hover:text-red-500 hover:border-red-200"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(index);
                      }}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex flex-col sm:flex-row gap-2 mt-4">
                <Button
                  className="flex-1 h-12 text-lg bg-gradient-to-r from-[#093765] to-blue-700 hover:from-[#052345] hover:to-blue-800 text-white shadow-lg shadow-blue-900/20 transition-all duration-300 rounded-xl"
                  disabled={files.length === 0 || files.some((f) => f.status === "uploading")}
                  onClick={handlePrint}
                >
                  Continue ({files.filter((f) => f.status === "completed").length} file{files.filter((f) => f.status === "completed").length !== 1 ? "s" : ""})
                </Button>
                <Button variant="outline" className="h-12 px-6 rounded-xl hover:bg-gray-100" onClick={() => setFiles([])}>
                  Clear All
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}