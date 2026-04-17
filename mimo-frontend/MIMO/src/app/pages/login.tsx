import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";

import {
  Printer,
  Mail,
  Lock,
  User,
  Phone,
  ArrowRight,
  Loader2,
} from "lucide-react";

import { toast } from "sonner";

const API_URL = import.meta.env.VITE_BACKEND_API_URL || "http://localhost:3000";

export function Login() {
  const navigate = useNavigate();
  const [isSignup, setIsSignup] = useState(false);
  const [username, setUsername] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const routeAfterAuth = async (jwtToken: string, fallbackName?: string) => {
    localStorage.setItem("token", jwtToken);

    // If backend already gave a user name (e.g., Google), use it immediately.
    if (fallbackName && fallbackName.trim()) {
      localStorage.setItem("mimo_user_name", fallbackName.trim());
      navigate("/upload");
      return;
    }

    try {
      const userRes = await fetch(`${API_URL}/mimo/user`, {
        headers: { Authorization: `Bearer ${jwtToken}` },
      });

      if (userRes.ok) {
        const userData = await userRes.json();
        const resolvedName = userData?.name?.trim?.();
        if (resolvedName) {
          localStorage.setItem("mimo_user_name", resolvedName);
          navigate("/upload");
          return;
        }
      }
    } catch (err) {
      console.warn("Failed to fetch user profile after login:", err);
    }

    // Only ask for onboarding if name truly isn't available.
    navigate("/onboarding");
  };

  // ================= NORMAL LOGIN / SIGNUP =================
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isSignup) {
        const registerRes = await fetch(`${API_URL}/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username,
            email,
            password,
            mobileNumber,
          }),
        });

        const registerText = await registerRes.text();

        if (!registerRes.ok) {
          throw new Error(registerText || "Signup failed");
        }

        toast.success("Account created. Please sign in.");
        setIsSignup(false);
        setPassword("");
      } else {
        const res = await fetch(`${API_URL}/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, password }),
        });

        const data = await res.json();

        if (!res.ok) throw new Error(data);

        toast.success("Signed in successfully!");
        await routeAfterAuth(data.jwtToken);
      }
    } catch (err: any) {
      toast.error(err.message || (isSignup ? "Signup failed" : "Login failed"));
    } finally {
      setLoading(false);
    }
  };

  // ================= GOOGLE LOGIN =================
  const handleGoogleSuccess = async (credentialResponse: any) => {
    try {
      const res = await fetch(`${API_URL}/google-login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: credentialResponse.credential,
        }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error("Google login failed");

      toast.success("Google login successful!");
      await routeAfterAuth(data.jwtToken, data.name);
    } catch {
      toast.error("Google login failed");
    }
  };

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center p-4 sm:p-6 bg-gradient-to-br from-blue-100 to-white relative overflow-hidden">
      {/* Background */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-blue-300/30 blur-[120px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-500/10 blur-[120px]" />

      <div className="w-full max-w-md space-y-6 relative z-10">
        {/* Logo */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-2xl mb-4">
            <Printer className="w-8 h-8 text-[#093765]" />
          </div>
          <h1 className="text-3xl font-bold text-[#093765]">
            {isSignup ? "Create MIMO Account" : "Sign in to MIMO"}
          </h1>
          <p className="text-slate-500">Vending Printer Management</p>
        </div>

        {/* Card */}
        <Card className="shadow-2xl bg-white">
          <CardHeader>
            <CardTitle className="text-center">{isSignup ? "Get Started" : "Welcome Back"}</CardTitle>
            <CardDescription className="text-center">
              {isSignup ? "Create your account" : "Enter your credentials"}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              {isSignup && (
                <>
                  <div>
                    <Label>Full Name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                      <Input
                        type="text"
                        className="pl-10"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required={isSignup}
                        disabled={loading}
                      />
                    </div>
                  </div>

                  <div>
                    <Label>Mobile Number</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                      <Input
                        type="tel"
                        className="pl-10"
                        value={mobileNumber}
                        onChange={(e) => setMobileNumber(e.target.value)}
                        required={isSignup}
                        disabled={loading}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Email */}
              <div>
                <Label>Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                  <Input
                    type="email"
                    className="pl-10"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <Label>Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                  <Input
                    type="password"
                    className="pl-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              {/* Login Button */}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <Loader2 className="animate-spin w-4 h-4" />
                ) : (
                  <>
                    {isSignup ? "Create Account" : "Sign In"} <ArrowRight className="ml-2 w-4 h-4" />
                  </>
                )}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setIsSignup((prev) => !prev);
                  setPassword("");
                }}
                disabled={loading}
              >
                {isSignup ? "Already have an account? Sign in" : "No account? Sign up"}
              </Button>
            </form>

            {/* Divider */}
            {!isSignup && (
              <>
                <div className="my-5 text-center text-sm text-gray-500">
                  OR
                </div>

                {/* ✅ REAL GOOGLE BUTTON */}
                <div className="flex justify-center">
                  <GoogleLogin
                    onSuccess={handleGoogleSuccess}
                    onError={() => toast.error("Google login failed")}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}