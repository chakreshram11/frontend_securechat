import React, { useState, useEffect } from "react";
import api, { setToken } from "../services/api";
import * as cryptoLib from "../lib/crypto";
import { MessageSquare, ShieldCheck, User, Lock, Wifi, WifiOff, Loader2 } from "lucide-react";

// 🔑 Save private key locally
async function savePrivateKey(privateKey) {
  // Check if Web Crypto API is available
  if (!window.crypto || !window.crypto.subtle) {
    console.warn("⚠️ Web Crypto API not available - cannot save private key");
    return null;
  }

  try {
    const exported = await window.crypto.subtle.exportKey("pkcs8", privateKey);
    const privB64 = btoa(String.fromCharCode(...new Uint8Array(exported)));
    localStorage.setItem("ecdhPrivateKey", privB64);
    return privB64;
  } catch (err) {
    console.error("❌ Failed to save private key:", err);
    return null;
  }
}

// 🔑 Load private key if already exists
async function loadPrivateKey() {
  // Check if Web Crypto API is available
  if (!window.crypto || !window.crypto.subtle) {
    console.warn("⚠️ Web Crypto API not available - cannot load private key");
    return null;
  }

  const b64 = localStorage.getItem("ecdhPrivateKey");
  if (!b64) return null;

  try {
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    return window.crypto.subtle.importKey(
      "pkcs8",
      raw,
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey", "deriveBits"]
    );
  } catch (err) {
    console.error("❌ Failed to load private key:", err);
    return null;
  }
}

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("checking");

  // Test backend connection on component mount
  useEffect(() => {
    (async () => {
      try {
        console.log("🔌 Testing backend connection...");
        const response = await api.get("/api/health");
        console.log("✅ Backend connection successful:", response.data);
        setConnectionStatus("connected");
      } catch (err) {
        console.error("❌ Backend connection failed:", err);
        setConnectionStatus("disconnected");
      }
    })();
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Login only
      let privateKey = await loadPrivateKey();
      const needPrivateKey = !privateKey;

      // If we have a local public key, send it
      const publicKeyRawBase64 = cryptoLib.getLocalPublicKey();

      // Build payload
      const payload = { username, password, needPrivateKey };
      if (publicKeyRawBase64) {
        payload.ecdhPublicKey = publicKeyRawBase64;
      }

      const { data } = await api.post("/api/auth/login", payload);

      // Always ensure we have valid keys in localStorage
      // Try server key first, but if it fails, generate new client-side keys
      let keysReady = false;

      // Check if Web Crypto API is available
      const hasWebCrypto = window.crypto && window.crypto.subtle;
      console.log("Has Web Crypto:", hasWebCrypto);
      if (!hasWebCrypto) {
        console.warn("⚠️ Web Crypto not available - will proceed without encryption");
      }

      // Only attempt ECDH key generation if Web Crypto is available
      if (hasWebCrypto) {
        // First, check if we have valid local keys that match the server
        const localPriv = localStorage.getItem("ecdhPrivateKey");
        const localPub = localStorage.getItem("ecdhPublicKey");
        const serverPub = data.user.ecdhPublicKey;

        // If local keys exist and local public matches server public, keys are synced
        if (localPriv && localPub && serverPub && localPub === serverPub) {
          console.log("✅ Local keys match server - using existing keys");
          keysReady = true;
        }
        // If server has encrypted private key, try to recover
        else if (data.ecdhPrivateKey) {
          // Try to verify the server key can be imported
          try {
            const raw = Uint8Array.from(atob(data.ecdhPrivateKey), (c) => c.charCodeAt(0)).buffer;
            await window.crypto.subtle.importKey(
              "pkcs8",
              raw,
              { name: "ECDH", namedCurve: "P-256" },
              true,
              ["deriveKey", "deriveBits"]
            );
            // Server key is valid - use it
            localStorage.setItem("ecdhPrivateKey", data.ecdhPrivateKey);
            if (data.user.ecdhPublicKey) {
              localStorage.setItem("ecdhPublicKey", data.user.ecdhPublicKey);
            }
            console.log("✅ Server private key restored and ready to use");
            keysReady = true;
          } catch (err) {
            console.warn("⚠️ Server private key format incompatible:", err.message);
          }
        }

        if (!keysReady) {
          try {
            console.log("🔄 Generating new client-side key pair...");
            const { privB64, pubB64 } = await cryptoLib.generateECDHKeyPair();
            console.log("✅ New key pair generated");

            let testKey = await loadPrivateKey();
            if (!testKey) {
              await new Promise(resolve => setTimeout(resolve, 200));
              testKey = await loadPrivateKey();
            }

            if (!testKey) {
              console.warn("⚠️ Key import verification failed, but keys are saved. Continuing...");
            } else {
              console.log("✅ Generated key verified and ready to use");
            }

            // Encrypt private key with password and upload to server for key recovery
            try {
              console.log("🔐 Encrypting private key for server storage...");
              const encryptedPrivKey = await cryptoLib.encryptPrivateKeyWithPassword(privB64, password);

              // We need to set token temporarily to make the API call
              // Use the token from the login response
              const tempToken = data.token;
              const originalToken = localStorage.getItem('token');
              localStorage.setItem('token', tempToken);

              await api.post('/api/auth/uploadKeys', {
                ecdhPublicKey: pubB64,
                ecdhPrivateKeyEncrypted: encryptedPrivKey
              });

              // Restore original token state (will be set properly later)
              if (originalToken) {
                localStorage.setItem('token', originalToken);
              } else {
                localStorage.removeItem('token');
              }

              console.log("✅ Encrypted private key uploaded to server for recovery");
            } catch (uploadErr) {
              console.warn("⚠️ Failed to upload encrypted key (non-critical):", uploadErr.message);
              // Keys still work locally, just can't recover on other devices
            }

            keysReady = true;
          } catch (genErr) {
            console.error("❌ Failed to generate keys:", genErr.message);
            console.warn("⚠️ Skipping ECDH - messages will be sent unencrypted");
            keysReady = true;
          }
        }
      } else {
        console.warn("⚠️ Web Crypto not available - proceeding without ECDH encryption");
        // Ensure server doesn't keep a stale public key for this account
        // so other users don't encrypt messages that this client cannot decrypt
        try {
          await api.post('/api/auth/uploadKey', { ecdhPublicKey: '' });
          console.log('✅ Cleared server-side public key since Web Crypto is unavailable');
        } catch (clearErr) {
          console.warn('⚠️ Failed to clear server public key (non-critical):', clearErr.message);
        }
        keysReady = true;
      }

      setToken(data.token);

      // Upload new public key AFTER setting token (non-blocking, don't wait)
      try {
        const localPub = cryptoLib.getLocalPublicKey();
        if (localPub) {
          api.post('/api/auth/uploadKey', { ecdhPublicKey: localPub })
            .then(() => console.log("✅ New public key uploaded to server"))
            .catch((uploadErr) => {
              console.warn("⚠️ Failed to upload new key (non-critical):", uploadErr);
            });
        } else {
          console.warn("⚠️ No local public key found to upload after login");
        }
      } catch (uploadErr) {
        console.warn("⚠️ Failed to attempt public key upload:", uploadErr);
      }

      onLogin(data.token);
    } catch (err) {
      console.error("Login error:", err);
      console.error("Error details:", {
        hasResponse: !!err.response,
        status: err.response?.status,
        message: err.message,
        code: err.code,
      });

      let errorMessage = "Authentication failed";

      if (!err.response) {
        // Network error - cannot reach server
        const apiBase = import.meta.env.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:5000`;
        errorMessage = `❌ Network Error\n\nCannot reach the backend server at:\n${apiBase}\n\nMake sure:\n1. Backend server is running on port 5000\n2. You have internet connectivity\n3. The server address is correct\n\nBackend logs:\n- Check that the server is listening on 0.0.0.0:5000\n- CORS should be enabled\n\nIf the server is running, wait a moment and try again.`;
      } else if (err.response?.status === 400) {
        errorMessage = err.response.data?.error || "Invalid credentials";
      } else if (err.response?.status === 500) {
        errorMessage = "Server error. Please try again later.";
      } else {
        errorMessage = err.response?.data?.error || err.message || "Authentication failed";
      }

      alert(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-4 relative overflow-hidden">
      {/* Decorative ambient background elements */}
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-md bg-white/95 dark:bg-slate-900/90 backdrop-blur-xl border border-slate-200/50 dark:border-slate-800/80 p-8 rounded-3xl shadow-2xl transition-all duration-300 relative z-10">
        {/* Header Branding */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-tr from-indigo-600 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/25 mb-4 transform hover:scale-105 transition-transform duration-300">
            <MessageSquare className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            Welcome Back
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1">
            <ShieldCheck className="w-4 h-4 text-emerald-500 inline" />
            End-to-End Encrypted Workspace
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-2">
              Username
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <User className="w-5 h-5" />
              </div>
              <input
                className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-transparent transition-all text-sm font-medium"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-2">
              Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Lock className="w-5 h-5" />
              </div>
              <input
                type="password"
                className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-transparent transition-all text-sm font-medium"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <button
            className={`w-full py-3.5 px-4 rounded-xl font-semibold text-white shadow-lg transition-all duration-200 flex items-center justify-center gap-2 ${
              isLoading || connectionStatus === "disconnected"
                ? "bg-slate-400 dark:bg-slate-700 cursor-not-allowed shadow-none"
                : "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 active:scale-[0.99] shadow-indigo-500/25"
            }`}
            type="submit"
            disabled={isLoading || connectionStatus === "disconnected"}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Logging in...
              </>
            ) : (
              "Sign In to Account"
            )}
          </button>
        </form>

        {/* Connection Status Badge */}
        <div className="mt-6 pt-4 border-t border-slate-200/60 dark:border-slate-800/80 text-center">
          {connectionStatus === "checking" && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 text-xs font-medium border border-amber-200/50 dark:border-amber-800/40">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Connecting to server...
            </div>
          )}
          {connectionStatus === "connected" && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 text-xs font-medium border border-emerald-200/50 dark:border-emerald-800/40">
              <Wifi className="w-3.5 h-3.5" />
              Server Connected
            </div>
          )}
          {connectionStatus === "disconnected" && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs font-medium border border-rose-200/50 dark:border-rose-800/40">
              <WifiOff className="w-3.5 h-3.5" />
              Server Offline ({import.meta.env.VITE_API_BASE || 'http://localhost:5000'})
            </div>
          )}

          <p className="text-xs text-slate-400 dark:text-slate-500 mt-4">
            Accounts are managed by your workspace administrator
          </p>
        </div>
      </div>
    </div>
  );
}
