import React, { useState, useEffect } from "react";
import api, { setToken } from "../services/api";
import * as cryptoLib from "../lib/crypto";

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
        if (data.ecdhPrivateKey) {
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
            console.log("✅ Server private key saved and ready to use");
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
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form
        className="bg-white p-6 rounded shadow w-96"
        onSubmit={handleLogin}
      >
        <h2 className="text-xl mb-4 font-semibold text-center">
          Login
        </h2>

        <input
          className="w-full mb-2 p-2 border rounded"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />

        <input
          type="password"
          className="w-full mb-4 p-2 border rounded"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button
          className={`px-4 py-2 rounded w-full text-white ${
            isLoading || connectionStatus === "disconnected" 
              ? "bg-gray-400 cursor-not-allowed" 
              : "bg-blue-600 hover:bg-blue-700"
          }`}
          type="submit"
          disabled={isLoading || connectionStatus === "disconnected"}
        >
          {isLoading ? "Logging in..." : "Login"}
        </button>
        
        <div className="mt-3 text-center text-sm">
          {connectionStatus === "checking" && (
            <p className="text-gray-500">🔌 Checking backend connection...</p>
          )}
          {connectionStatus === "connected" && (
            <p className="text-green-600">✅ Backend connected</p>
          )}
          {connectionStatus === "disconnected" && (
            <p className="text-red-600 font-semibold">❌ Backend not reachable ({import.meta.env.VITE_API_BASE || 'http://localhost:5000'})</p>
          )}
        </div>
        
        <p className="text-xs text-gray-500 text-center mt-4">
          Contact your administrator to create an account
        </p>
      </form>
    </div>
  );
}
