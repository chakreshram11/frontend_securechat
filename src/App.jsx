import React, { useState, useEffect } from "react";
import Login from "./pages/Login";
import Chat from "./pages/Chat";
import { toast } from "react-toastify";

// ✅ Import toastify
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

export default function App() {
  // ✅ Use sessionStorage → supports multiple users in different tabs
  const [token, setToken] = useState(sessionStorage.getItem("token"));

  // Check secure context on app load
  useEffect(() => {
    const isSecure = window.isSecureContext === true;
    const protocol = window.location.protocol;
    
    if (!isSecure && protocol === 'https:') {
      console.warn("⚠️ HTTPS detected but browser reports insecure context");
      console.warn("   This usually means the SSL certificate is invalid or self-signed");
      console.warn("   Web Crypto API may not work properly. Please:");
      console.warn("   1. Accept the certificate in your browser");
      console.warn("   2. Or use a valid SSL certificate");
      
      toast.warning(
        "⚠️ Security Warning: Your connection is not fully secure. " +
        "Encryption features may not work. Please accept the SSL certificate or use a valid certificate.",
        {
          autoClose: 8000,
          position: "top-center"
        }
      );
    }
    
    // Test Web Crypto API availability
    if (!window.crypto || !window.crypto.subtle) {
      console.error("❌ Web Crypto API is not available");
      toast.error(
        "❌ Web Crypto API is not available. Encryption will not work. " +
        "Please use a modern browser (Chrome, Firefox, Edge) with HTTPS.",
        {
          autoClose: 10000,
          position: "top-center"
        }
      );
    }
  }, []);

  useEffect(() => {
    if (token) {
      sessionStorage.setItem("token", token);
    } else {
      sessionStorage.removeItem("token");
    }
  }, [token]);

  return (
    <>
      {/* ✅ Global Toast Notifications */}
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnHover
        draggable
        theme="colored"
      />

      {/* ✅ Show Login if no token, else Chat */}
      {!token ? (
        <Login onLogin={(t) => setToken(t)} />
      ) : (
        <div className="h-screen flex flex-col">
        <Chat token={token} onLogout={() => setToken(null)} />
        </div>
      )}
    </>
  );
}
