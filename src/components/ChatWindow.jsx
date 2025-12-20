// frontend/src/components/ChatWindow.jsx
import React, { useEffect, useState, useRef } from "react";
import api from "../services/api";
import * as cryptoLib from "../lib/crypto";
import { toast } from "react-toastify";
import { generateECDHKeyPair } from "../lib/crypto";

// 🔑 load private ECDH key from localStorage
export async function loadLocalPrivateKey() {
  const b64 = localStorage.getItem("ecdhPrivateKey");
  if (!b64) {
    console.log("❌ No private key found in localStorage");
    console.log("Available localStorage keys:", Object.keys(localStorage));
    return null;
  }
  
  console.log("🔍 Attempting to import private key, length:", b64.length);
  
  try {
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    console.log("🔍 Raw key buffer length:", raw.byteLength);
    
    const key = await window.crypto.subtle.importKey(
      "pkcs8",
      raw,
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey", "deriveBits"]
    );
    console.log("✅ Private key imported successfully");
    return key;
  } catch (err) {
    console.error("❌ Failed to import private key:", err);
    console.error("Error name:", err.name);
    console.error("Error message:", err.message);
    console.error("Key length:", b64.length);
    console.error("First 50 chars of key:", b64.substring(0, 50));
    
    // Don't remove the key automatically - let user try to re-login
    // The key might be valid but in a different format
    return null;
  }
}

export default function ChatWindow({ other, socket, myUserId }) {
  const [history, setHistory] = useState([]);
  const [text, setText] = useState("");
  const [aesKey, setAesKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploadingFiles, setUploadingFiles] = useState([]);
  const [hasRecipientKey, setHasRecipientKey] = useState(true);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef();

  const appendNewMessage = (m) => setHistory((prev) => [...prev, m]);

  /* ---------- Initialize ECDH key pair (once per user) ---------- */
  useEffect(() => {
    (async () => {
      // Generate ECDH keypair if not already present
      const existingPub = localStorage.getItem("ecdhPublicKey");
      if (!existingPub) {
        await generateECDHKeyPair();
        console.log("✅ ECDH key pair generated");
      }
      // Clear cached AES keys (optional — only once)
      if (!localStorage.getItem("aesKeys")) {
        localStorage.removeItem("aesKeys");
      }
    })();
  }, []);

  /* ---------- Load AES key + history ---------- */
  useEffect(() => {
    (async () => {
      try {
        const { data: otherUser } = await api.get(`/api/users/${other._id}`);
        let myPriv = await loadLocalPrivateKey();
        
        // If no private key, try to generate a new one and update server
        if (!myPriv) {
          console.log("⚠️ No private key found in localStorage");
          console.log("Available keys:", {
            hasPrivate: !!localStorage.getItem("ecdhPrivateKey"),
            hasPublic: !!localStorage.getItem("ecdhPublicKey"),
            token: !!localStorage.getItem("token")
          });
          
          try {
            // Generate new keys - this will automatically save to localStorage
            console.log("🔄 Generating new key pair...");
            const { privB64, pubB64 } = await generateECDHKeyPair();
            console.log("✅ New key pair generated, private key length:", privB64.length);
            
            // Small delay to ensure localStorage is written
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // Load the newly generated key from localStorage
            myPriv = await loadLocalPrivateKey();
            
            if (!myPriv) {
              console.error("❌ Failed to load newly generated key");
              // One more retry
              await new Promise(resolve => setTimeout(resolve, 100));
              myPriv = await loadLocalPrivateKey();
            }
            
            if (!myPriv) {
              console.error("❌ Still failed to load key after retries");
              toast.error("⚠️ Encryption key issue. Please log out and log back in.", {
                autoClose: 5000
              });
              setLoading(false);
              return;
            }
            
            console.log("✅ Successfully loaded newly generated private key");
            
            // Try to update the server with the new public key (non-blocking, don't wait)
            api.post('/api/auth/uploadKey', { ecdhPublicKey: pubB64 })
              .then(() => console.log("✅ New public key uploaded to server"))
              .catch((uploadErr) => {
                console.warn("⚠️ Failed to upload new key to server (non-critical):", uploadErr);
                // This is not critical - the key is saved locally and will work
              });
          } catch (genErr) {
            console.error("❌ Failed to generate new key:", genErr);
            console.error("Error name:", genErr.name);
            console.error("Error message:", genErr.message);
            toast.error("⚠️ Failed to generate encryption keys. Please log out and log back in.", {
              autoClose: 5000
            });
            setLoading(false);
            return;
          }
        }
        
        if (!myPriv) {
          toast.error("⚠️ Missing local ECDH private key. Please re-login.");
          setLoading(false);
          return;
        }

        // 🚨 Handle case: recipient has no ECDH public key yet
        if (!otherUser.ecdhPublicKey) {
          toast.warning(
            `⚠️ ${otherUser.displayName || otherUser.username} hasn’t logged in yet. You can message them once they’re online.`,
            {
              toastId: `no-key-${otherUser._id}`,
              position: "top-center",
              autoClose: 5000,
              theme: "light",
            }
          );
          setHasRecipientKey(false);
          setLoading(false);
          return;
        } else {
          setHasRecipientKey(true);
        }

        // Derive AES key - always re-derive to ensure we use the latest public key
        console.log("🔑 Deriving AES key for user:", otherUser.username);
        console.log("   Other user's public key length:", otherUser.ecdhPublicKey?.length);
        console.log("   My public key length:", cryptoLib.getLocalPublicKey()?.length);
        
        let importedKey;
        try {
          // Verify we have the recipient's public key
          if (!otherUser.ecdhPublicKey) {
            throw new Error("Recipient has no public key");
          }
          
          const derived = await cryptoLib.deriveSharedAESKey(
            myPriv,
            otherUser.ecdhPublicKey
          );
          importedKey = await cryptoLib.importAesKeyFromRawBase64(
            derived.rawKeyBase64
          );
          // Always update cached key to ensure it's current
          cryptoLib.saveAesKeyForUser(other._id, derived.rawKeyBase64);
          console.log("✅ AES key derived and cached successfully");
        } catch (deriveErr) {
          console.error("❌ Failed to derive AES key:", deriveErr);
          console.error("   Error details:", deriveErr.message);
          throw new Error("Could not derive AES key for encryption");
        }

        setAesKey(importedKey);

        // Fetch + decrypt history
        const { data } = await api.get(`/api/messages/history/${other._id}`);
        const decrypted = await Promise.all(
          data.map(async (m) => {
            if (!m.ciphertext) {
              return {
                ...m,
                plaintext: "[No ciphertext]",
                isMe: m.senderId === myUserId,
              };
            }
            
            const isMe = String(m.senderId) === String(myUserId);
            let plaintext = null;
            
            // Strategy 1: Try cached AES key for this sender/receiver
            if (m.senderId) {
              const cachedKeyB64 = cryptoLib.loadAesKeyForUser(m.senderId);
              if (cachedKeyB64) {
                try {
                  const cachedKey = await cryptoLib.importAesKeyFromRawBase64(cachedKeyB64);
                  plaintext = await cryptoLib.decryptWithAesKey(cachedKey, m.ciphertext);
                  console.log("✅ Decrypted using cached key");
                  return { ...m, plaintext, isMe };
                } catch (cachedErr) {
                  console.warn("⚠️ Cached key failed, trying other methods");
                }
              }
            }
            
            // Strategy 2: For messages from others, try sender's public key from meta (CORRECT approach)
            // The sender encrypted with: senderPrivateKey + myPublicKey
            // I decrypt with: myPrivateKey + senderPublicKey (from meta) = same shared secret
            if (!isMe && m.meta?.senderPublicKey) {
              try {
                console.log("🔑 Trying sender's public key from meta for message from:", m.senderId);
                console.log("   Sender public key (first 50):", m.meta.senderPublicKey.substring(0, 50));
                
                // Verify the public key format
                if (m.meta.senderPublicKey.length < 100) {
                  console.error("⚠️ Sender public key seems too short:", m.meta.senderPublicKey.length);
                }
                
                const { aesKey: senderKey, rawKeyBase64 } = await cryptoLib.deriveSharedAESKey(
                  myPriv,
                  m.meta.senderPublicKey
                );
                console.log("   ✅ Key derived, attempting decryption...");
                
                plaintext = await cryptoLib.decryptWithAesKey(senderKey, m.ciphertext);
                console.log("   ✅ Decrypted successfully:", plaintext.substring(0, 50));
                
                cryptoLib.saveAesKeyForUser(m.senderId, rawKeyBase64);
                console.log("✅ Decrypted using sender's key from meta");
                return { ...m, plaintext, isMe };
              } catch (metaErr) {
                console.error("❌ Sender's key from meta failed:", metaErr.message);
                console.error("   Error name:", metaErr.name);
                console.error("   Error details:", {
                  hasPrivateKey: !!myPriv,
                  hasSenderPublicKey: !!m.meta.senderPublicKey,
                  senderPublicKeyLength: m.meta.senderPublicKey?.length,
                  ciphertextLength: m.ciphertext?.length,
                  senderPublicKeyValid: m.meta.senderPublicKey && m.meta.senderPublicKey.length > 100
                });
                if (metaErr.stack) {
                  console.error("   Stack:", metaErr.stack);
                }
              }
            }
            
            // Strategy 3: For messages I sent, try current recipient's key
            // I encrypted with: myPrivateKey + recipientPublicKey (at time of sending)
            // To decrypt, I need: myPrivateKey + recipientPublicKey (same key)
            // Note: This only works if recipient's key hasn't changed
            if (isMe) {
              try {
                plaintext = await cryptoLib.decryptWithAesKey(importedKey, m.ciphertext);
                console.log("✅ Decrypted my message using current recipient key");
                return { ...m, plaintext, isMe };
              } catch (myMsgErr) {
                console.warn("⚠️ Current recipient key failed for my message:", myMsgErr.message);
                // Try to use cached key if available
                const cachedKeyB64 = cryptoLib.loadAesKeyForUser(other._id);
                if (cachedKeyB64) {
                  try {
                    const cachedKey = await cryptoLib.importAesKeyFromRawBase64(cachedKeyB64);
                    plaintext = await cryptoLib.decryptWithAesKey(cachedKey, m.ciphertext);
                    console.log("✅ Decrypted my message using cached recipient key");
                    return { ...m, plaintext, isMe };
                  } catch (cachedErr) {
                    console.warn("⚠️ Cached recipient key also failed");
                  }
                }
              }
            }
            
            // Strategy 4: For messages from others, try fetching their current public key
            if (!isMe && m.senderId) {
              try {
                const { data: senderUser } = await api.get(`/api/users/${m.senderId}`);
                if (senderUser?.ecdhPublicKey) {
                  const { aesKey: serverKey, rawKeyBase64 } = await cryptoLib.deriveSharedAESKey(
                    myPriv,
                    senderUser.ecdhPublicKey
                  );
                  plaintext = await cryptoLib.decryptWithAesKey(serverKey, m.ciphertext);
                  cryptoLib.saveAesKeyForUser(m.senderId, rawKeyBase64);
                  console.log("✅ Decrypted using sender's current key from server");
                  return { ...m, plaintext, isMe };
                }
              } catch (fetchErr) {
                console.warn("⚠️ Failed to fetch/use sender's current key");
              }
            }
            
            // Strategy 5: For messages I sent, try recipient's current key (already tried, but log it)
            if (isMe) {
              console.warn("⚠️ Could not decrypt my own message - recipient's key may have changed");
            }
            
            // All strategies failed
            console.error("❌ All decryption attempts failed for message:", {
              id: m._id || m.id,
              senderId: m.senderId,
              isMe,
              hasMeta: !!m.meta,
              hasSenderPublicKey: !!m.meta?.senderPublicKey
            });
            return { ...m, plaintext: "[Decryption Error]", isMe };
          })
        );
        setHistory(decrypted);
      } catch (err) {
        console.error("❌ Error loading chat:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [other, myUserId]);

  /* ---------- Incoming messages ---------- */
  useEffect(() => {
    if (!socket) return;

    const handler = async (m) => {
      try {
        if (!m.senderId || !m.ciphertext) return;
        
        // Only process messages relevant to this chat window
        // Message should be either:
        // - From the other user to me (m.senderId === other._id && m.receiverId === myUserId)
        // - Or from me to the other user (but we handle sent messages differently)
        const isFromOtherToMe = String(m.senderId) === String(other._id) && String(m.receiverId) === String(myUserId);
        const isFromMeToOther = String(m.senderId) === String(myUserId) && String(m.receiverId) === String(other._id);
        
        // Skip if this message is not for this conversation
        if (!isFromOtherToMe && !isFromMeToOther) {
          return;
        }
        
        // For messages we sent, they're already added to history when sent, so skip
        if (isFromMeToOther) {
          return;
        }
        
        const myPriv = await loadLocalPrivateKey();
        if (!myPriv) {
          console.error("❌ No private key available for decryption");
          appendNewMessage({
            ...m,
            plaintext: "[Decryption Error - No Key]",
            isMe: false,
          });
          return;
        }
        
        let text = "[Decryption Error]";
        let decryptionSucceeded = false;
        
        // Log message details for debugging
        console.log("📥 Incoming message for decryption:", {
          senderId: m.senderId,
          receiverId: m.receiverId,
          hasMeta: !!m.meta,
          hasSenderPublicKey: !!m.meta?.senderPublicKey,
          senderPublicKeyLength: m.meta?.senderPublicKey?.length,
          ciphertextLength: m.ciphertext?.length,
          isFromOtherToMe,
          isFromMeToOther
        });
        
        // Strategy 1: Use sender's public key from message meta (most reliable for messages from others)
        // The sender encrypted with: senderPrivateKey + myPublicKey
        // I decrypt with: myPrivateKey + senderPublicKey (from meta) = same shared secret
        if (m.meta?.senderPublicKey) {
          try {
            console.log("🔑 Strategy 1: Attempting decryption with sender's public key from message meta");
            console.log("   Sender ID:", m.senderId);
            console.log("   Sender's public key (first 50 chars):", m.meta.senderPublicKey.substring(0, 50));
            console.log("   Sender's public key length:", m.meta.senderPublicKey.length);
            console.log("   Ciphertext length:", m.ciphertext.length);
            console.log("   Has my private key:", !!myPriv);
            
            const { aesKey: derived, rawKeyBase64 } =
              await cryptoLib.deriveSharedAESKey(myPriv, m.meta.senderPublicKey);
            console.log("   ✅ Key derived successfully");
            
            text = await cryptoLib.decryptWithAesKey(derived, m.ciphertext);
            console.log("   ✅ Decrypted successfully, text:", text.substring(0, 50));
            
            cryptoLib.saveAesKeyForUser(m.senderId, rawKeyBase64);
            
            // If this is a message for the current chat, update the aesKey state
            if (String(m.receiverId) === String(myUserId) && String(other._id) === String(m.senderId)) {
              setAesKey(derived);
            }
            
            console.log("✅ Successfully decrypted using sender's public key from meta");
            decryptionSucceeded = true;
          } catch (metaErr) {
            console.error("❌ Strategy 1 failed - Decryption with sender's key from meta failed:");
            console.error("   Error name:", metaErr.name);
            console.error("   Error message:", metaErr.message);
            console.error("   Error details:", {
              hasPrivateKey: !!myPriv,
              hasSenderPublicKey: !!m.meta.senderPublicKey,
              senderPublicKeyLength: m.meta.senderPublicKey?.length,
              ciphertextLength: m.ciphertext?.length,
              senderPublicKeyValid: m.meta.senderPublicKey && m.meta.senderPublicKey.length > 100
            });
            if (metaErr.stack) console.error("   Stack:", metaErr.stack);
            
            // Check if it's a Web Crypto API error
            if (metaErr.name === "NotSupportedError" || metaErr.name === "InvalidAccessError" || 
                metaErr.message.includes("secure context") || metaErr.message.includes("crypto")) {
              console.error("🚨 Web Crypto API error detected - this may be due to insecure context");
              console.error("   isSecureContext:", window.isSecureContext);
              console.error("   protocol:", window.location.protocol);
            }
          }
        } else {
          console.warn("⚠️ Strategy 1 skipped - No senderPublicKey in message meta");
          console.warn("   Message meta:", m.meta);
          console.warn("   Message ID:", m.id || m._id);
          console.warn("   This is likely an old message or message sent without proper meta");
        }
        
        // Strategy 2: Try cached AES key for this sender
        if (!decryptionSucceeded) {
          const cachedKeyB64 = cryptoLib.loadAesKeyForUser(m.senderId);
          if (cachedKeyB64) {
            try {
              console.log("🔑 Attempting decryption with cached AES key for sender");
              const cachedKey = await cryptoLib.importAesKeyFromRawBase64(cachedKeyB64);
              text = await cryptoLib.decryptWithAesKey(cachedKey, m.ciphertext);
              console.log("✅ Successfully decrypted using cached AES key");
              decryptionSucceeded = true;
            } catch (cachedErr) {
              console.warn("⚠️ Decryption with cached key failed:", cachedErr.message);
            }
          }
        }
        
        // Strategy 3: Try current aesKey (only if it's for the current chat)
        if (!decryptionSucceeded && aesKey && String(other._id) === String(m.senderId)) {
          try {
            console.log("🔑 Attempting decryption with current chat's AES key");
            text = await cryptoLib.decryptWithAesKey(aesKey, m.ciphertext);
            console.log("✅ Successfully decrypted using current chat's AES key");
            decryptionSucceeded = true;
          } catch (currentErr) {
            console.warn("⚠️ Decryption with current AES key failed:", currentErr.message);
          }
        }
        
        // Strategy 4: Fetch sender's public key from server
        if (!decryptionSucceeded) {
          try {
            console.log("🔑 Fetching sender's public key from server");
            const { data: senderUser } = await api.get(`/api/users/${m.senderId}`);
            if (senderUser?.ecdhPublicKey) {
              const { aesKey: derived, rawKeyBase64 } =
                await cryptoLib.deriveSharedAESKey(myPriv, senderUser.ecdhPublicKey);
              text = await cryptoLib.decryptWithAesKey(derived, m.ciphertext);
              cryptoLib.saveAesKeyForUser(m.senderId, rawKeyBase64);
              
              // If this is a message for the current chat, update the aesKey state
              if (String(m.receiverId) === String(myUserId) && String(other._id) === String(m.senderId)) {
                setAesKey(derived);
              }
              
              console.log("✅ Successfully decrypted using sender's public key from server");
              decryptionSucceeded = true;
            }
          } catch (fetchErr) {
            console.error("❌ Failed to fetch/use sender's key from server:", fetchErr);
          }
        }
        
        // If all strategies failed
        if (!decryptionSucceeded) {
          console.error("❌ All decryption strategies failed for message from:", m.senderId);
          console.error("   Message details:", {
            id: m.id,
            senderId: m.senderId,
            receiverId: m.receiverId,
            hasMeta: !!m.meta,
            hasSenderPublicKeyInMeta: !!m.meta?.senderPublicKey,
            ciphertextLength: m.ciphertext?.length,
            createdAt: m.createdAt
          });
          console.error("   Available info:", {
            hasMyPrivateKey: !!myPriv,
            currentChatUserId: other._id,
            isForCurrentChat: String(m.senderId) === String(other._id)
          });
          text = "[Decryption Error]";
        }

        appendNewMessage({
          ...m,
          plaintext: text,
          isMe: false,
        });
      } catch (err) {
        console.error("❌ Decrypt failed:", err);
        appendNewMessage({
          ...m,
          plaintext: "[Decryption Error]",
          isMe: String(m.senderId) === String(myUserId),
        });
      }
    };

    socket.on("message", handler);
    return () => socket.off("message", handler);
  }, [socket, aesKey, myUserId, other._id]);

  /* ---------- Auto-scroll ---------- */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  /* ---------- Send text ---------- */
  async function send() {
    if (!text.trim() || !aesKey) {
      console.error("❌ Cannot send: missing text or AES key");
      return;
    }
    try {
      const myPublicKey = cryptoLib.getLocalPublicKey();
      if (!myPublicKey) {
        console.error("❌ Cannot send: No public key found in localStorage");
        toast.error("⚠️ Missing encryption key. Please log out and log back in.");
        return;
      }
      
      console.log("📤 Sending message:", {
        textLength: text.length,
        hasAesKey: !!aesKey,
        hasPublicKey: !!myPublicKey,
        publicKeyLength: myPublicKey.length,
        receiverId: other._id
      });
      
      const c = await cryptoLib.encryptWithAesKey(aesKey, text);
      console.log("✅ Message encrypted, ciphertext length:", c.length);
      
      // Verify encryption worked by trying to decrypt it (for debugging)
      try {
        const testDecrypt = await cryptoLib.decryptWithAesKey(aesKey, c);
        if (testDecrypt !== text) {
          console.error("🚨 Encryption verification failed - decrypted text doesn't match!");
        } else {
          console.log("✅ Encryption verified - can decrypt own message");
        }
      } catch (verifyErr) {
        console.error("🚨 Encryption verification failed:", verifyErr);
      }
      
      appendNewMessage({
        senderId: myUserId,
        receiverId: other._id,
        plaintext: text,
        ciphertext: c,
        type: "text",
        createdAt: new Date(),
        isMe: true,
        read: false,
      });

      const messagePayload = {
        receiverId: other._id,
        ciphertext: c,
        type: "text",
        meta: {
          senderPublicKey: myPublicKey,
        },
      };
      
      // Verify meta is properly formatted
      if (!messagePayload.meta || !messagePayload.meta.senderPublicKey) {
        console.error("🚨 CRITICAL: senderPublicKey is missing from message payload!");
        toast.error("⚠️ Encryption error: Missing public key in message");
        return;
      }
      
      console.log("📤 Emitting sendMessage with payload:", {
        receiverId: messagePayload.receiverId,
        ciphertextLength: messagePayload.ciphertext.length,
        hasMeta: !!messagePayload.meta,
        hasSenderPublicKey: !!messagePayload.meta.senderPublicKey,
        senderPublicKeyLength: messagePayload.meta.senderPublicKey?.length,
        senderPublicKeyPreview: messagePayload.meta.senderPublicKey?.substring(0, 50)
      });
      
      socket.emit("sendMessage", messagePayload);
      
      console.log("✅ Message sent with senderPublicKey in meta");

      setText("");
    } catch (err) {
      console.error("❌ Failed to send", err);
      console.error("Error details:", err.message, err.stack);
    }
  }

  /* ---------- File upload ---------- */
  async function handleFiles(files) {
    if (!files.length || !aesKey) return;
    for (let file of files) {
      const id = Date.now() + file.name;
      const uploadEntry = { id, name: file.name, progress: 0 };
      setUploadingFiles((prev) => [...prev, uploadEntry]);

      try {
        const form = new FormData();
        form.append("file", file);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/messages/upload");
        xhr.setRequestHeader(
          "Authorization",
          "Bearer " + localStorage.getItem("token")
        );

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            setUploadingFiles((prev) =>
              prev.map((f) => (f.id === id ? { ...f, progress: percent } : f))
            );
          }
        };

        xhr.onload = async () => {
          if (xhr.status === 200) {
            const { url } = JSON.parse(xhr.responseText);
            const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name);

            appendNewMessage({
              senderId: myUserId,
              receiverId: other._id,
              plaintext: isImage ? "🖼️ Image" : `📎 ${file.name}`,
              type: "file",
              meta: { url, name: file.name, isImage },
              createdAt: new Date(),
              isMe: true,
              read: false,
            });

            const c = await cryptoLib.encryptWithAesKey(
              aesKey,
              `File: ${file.name}`
            );

            socket.emit("sendMessage", {
              receiverId: other._id,
              ciphertext: c,
              type: "text",
              meta: {
                senderPublicKey: await cryptoLib.getLocalPublicKey(),
              },
            });
          }
          setUploadingFiles((prev) => prev.filter((f) => f.id !== id));
        };

        xhr.onerror = () => {
          console.error("❌ Upload failed");
          setUploadingFiles((prev) => prev.filter((f) => f.id !== id));
        };

        xhr.send(form);
      } catch (err) {
        console.error("❌ File upload failed", err);
      }
    }
  }

  /* ---------- Render ---------- */
  return (
    <div className="flex flex-col h-full bg-white relative">
      {/* Header */}
      <div className="border-b p-3 font-semibold bg-gray-100 flex justify-between items-center">
        <span>{other.displayName || other.username}</span>
        <button
          className="text-blue-600 hover:underline"
          onClick={() => fileInputRef.current.click()}
        >
          📎
        </button>
        <input
          type="file"
          multiple
          hidden
          ref={fileInputRef}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto p-4 flex flex-col-reverse space-y-reverse space-y-3"
        style={{ minHeight: 0 }}
        ref={messagesEndRef}
      >
        {loading ? (
          <div className="text-center text-gray-500">⏳ Loading...</div>
        ) : (
          history
            .slice()
            .reverse()
            .map((m, i) => (
              <div
                key={i}
                className={`flex ${m.isMe ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-xs sm:max-w-md p-2 rounded-lg shadow text-sm ${
                    m.isMe
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-800"
                  }`}
                >
                  {m.type === "file" && m.meta?.url ? (
                    m.meta.isImage ? (
                      <img
                        src={m.meta.url}
                        alt={m.meta.name}
                        className="rounded max-h-60 object-contain"
                      />
                    ) : (
                      <a
                        href={m.meta.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {m.plaintext}
                      </a>
                    )
                  ) : (
                    <div>{m.plaintext}</div>
                  )}
                  <div className="text-xs opacity-70 mt-1 flex justify-between">
                    <span>{new Date(m.createdAt).toLocaleTimeString()}</span>
                    {m.isMe && <span>{m.read ? "✅" : "✔️"}</span>}
                  </div>
                </div>
              </div>
            ))
        )}

        {/* Upload progress */}
        {uploadingFiles.map((f) => (
          <div key={f.id} className="text-sm text-gray-600">
            {f.name} - {f.progress}%
          </div>
        ))}
      </div>

      {/* Input */}
      {!hasRecipientKey ? (
        <div className="p-4 text-center text-yellow-700 bg-yellow-50 border-t border-yellow-300">
          ⚠️ {other.displayName || other.username} hasn’t logged in yet.
          <br />
          You’ll be able to message them once they log in.
        </div>
      ) : (
        <div className="p-3 border-t flex gap-2 bg-gray-50 sticky bottom-0">
          <input
            className="flex-1 border rounded px-3 py-2 text-sm"
            placeholder="Type a message..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            onClick={send}
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}
