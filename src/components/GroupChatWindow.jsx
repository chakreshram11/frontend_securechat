// frontend/src/components/GroupChatWindow.jsx
import React, { useEffect, useState, useRef } from "react";
import api from "../services/api";
import * as cryptoLib from "../lib/crypto";
import { toast } from "react-toastify";
import { loadLocalPrivateKey } from "./ChatWindow";
import FileUpload from "./FileUpload";

export default function GroupChatWindow({ group, socket, myUserId }) {
  const [history, setHistory] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploadingFiles, setUploadingFiles] = useState([]);
  const [memberKeys, setMemberKeys] = useState({}); // userId -> AES key
  const [groupKey, setGroupKey] = useState(null); // Group AES key for encryption
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef();
  const pendingMessagesRef = useRef({}); // memberId -> { tempId, plaintext, ciphertext } // memberId -> { tempId, plaintext, ciphertext }

  const appendNewMessage = (m) => {
    setHistory((prev) => {
      // Check if this message already exists in history to prevent duplicates
      const alreadyExists = prev.some(
        existing =>
          existing._id === m._id ||
          (existing.tempId && existing.tempId === m.tempId) ||
          (existing.ciphertext === m.ciphertext && existing.senderId === m.senderId && !m._id && !existing._id)
      );
      if (alreadyExists) {
        console.log("🔄 Prevented duplicate message:", m.plaintext || m.ciphertext);
        return prev; // Don't add duplicate
      }
      return [...prev, m];
    });
  };

  /* ---------- Join group room and load history ---------- */
  useEffect(() => {
    if (!socket || !group) return;

    // Join the group room
    socket.emit("joinGroup", String(group._id));

    // Track if we're currently loading history to prevent race conditions
    let isLoadingHistory = true;
    window.incomingMessagesDuringLoad = [];

    (async () => {
      try {
        setLoading(true);

        // Fetch and decrypt group key first
        let decryptedGroupKey = null;
        try {
          const keyResponse = await api.get(`/api/groups/${String(group._id)}/key`);
          if (keyResponse.data?.encryptedKey) {
            const keyB64 = await cryptoLib.decryptGroupKey(keyResponse.data.encryptedKey);
            decryptedGroupKey = await cryptoLib.cacheGroupKey(String(group._id), keyB64);
            setGroupKey(decryptedGroupKey);
            console.log("🔐 Group key decrypted and cached");
          }
        } catch (keyErr) {
          console.warn("⚠️ No group key available (group may not have encryption set up):", keyErr.message);
          // Continue without encryption - old groups won't have keys
        }

        // Load group message history
        let { data } = await api.get(`/api/messages/group/${String(group._id)}`);
        // If API call fails, initialize with empty array
        if (!data || !Array.isArray(data)) {
          console.warn("⚠️ API returned invalid data, initializing with empty array");
          data = [];
        }

        const myPriv = await loadLocalPrivateKey();
        if (!myPriv) {
          console.log("ℹ️ No local private key available - showing unencrypted messages and placeholders for encrypted content");
          // This is expected behavior when users haven't set up encryption keys yet
          // The app will show unencrypted messages normally and placeholders for encrypted messages
        }

        // Decrypt messages
        const decrypted = await Promise.all(
          data.map(async (m) => {
            if (!m.ciphertext) {
              return {
                ...m,
                plaintext: "[No ciphertext]",
                isMe: String(m.senderId?._id || m.senderId) === String(myUserId),
                senderName: m.senderId?.displayName || m.senderId?.username || "Unknown",
              };
            }

            const senderId = m.senderId?._id || m.senderId;
            const isMe = String(senderId) === String(myUserId);
            let plaintext = null;
            let senderName = m.senderId?.displayName || m.senderId?.username || "Unknown";

            // If this message is explicitly unencrypted, treat as plaintext
            if (m.meta?.unencrypted) {
              // Check if this is a file message
              const fileInfo = m.meta?.fileInfo || (m.meta?.url ? m.meta : null);
              if (m.type === "file" || fileInfo) {
                const info = fileInfo || m.meta || {};
                return {
                  ...m,
                  plaintext: info.isImage ? "🖼️ Image" : `📎 ${info.name || 'File'}`,
                  type: "file",
                  meta: {
                    url: info.url,
                    name: info.name,
                    isImage: info.isImage,
                    ...(m.meta || {})
                  },
                  isMe,
                  senderName,
                };
              }

              return {
                ...m,
                plaintext: m.ciphertext,
                isMe,
                senderName,
              };
            }

            // If ciphertext is very short, treat as plaintext (backwards compatibility)
            if (m.ciphertext.length < 29) {
              // Check if this is a file message
              const fileInfo = m.meta?.fileInfo || (m.meta?.url ? m.meta : null);
              if (m.type === "file" || fileInfo) {
                const info = fileInfo || m.meta || {};
                return {
                  ...m,
                  plaintext: info.isImage ? "🖼️ Image" : `📎 ${info.name || 'File'}`,
                  type: "file",
                  meta: {
                    url: info.url,
                    name: info.name,
                    isImage: info.isImage,
                    ...(m.meta || {})
                  },
                  isMe,
                  senderName,
                };
              }

              return {
                ...m,
                plaintext: m.ciphertext,
                isMe,
                senderName,
              };
            }

            // Strategy 0: Try group key first (new encrypted messages)
            if (decryptedGroupKey) {
              try {
                plaintext = await cryptoLib.decryptWithAesKey(decryptedGroupKey, m.ciphertext);
                console.log("✅ Group message decrypted using group key");
                return {
                  ...m,
                  plaintext,
                  isMe,
                  senderName,
                };
              } catch (groupDecryptErr) {
                console.log("ℹ️ Group key decryption failed, trying other strategies...");
                // Continue to other strategies for backwards compatibility
              }
            }

            // If we don't have a local private key, we cannot decrypt encrypted messages
            if (!myPriv) {
              console.warn('⚠️ Cannot decrypt group message (no local private key) - showing placeholder');
              return {
                ...m,
                plaintext: "[Encrypted - no key]",
                isMe,
                senderName,
              };
            }

            // Strategy 1: Try cached AES key for this sender (backwards compat)
            if (senderId) {
              const cachedKeyB64 = cryptoLib.loadAesKeyForUser(senderId);
              if (cachedKeyB64) {
                try {
                  const cachedKey = await cryptoLib.importAesKeyFromRawBase64(cachedKeyB64);
                  plaintext = await cryptoLib.decryptWithAesKey(cachedKey, m.ciphertext);
                  console.log("✅ Group message decrypted using cached key");
                  setMemberKeys((prev) => ({ ...prev, [senderId]: cachedKey }));
                  return {
                    ...m,
                    plaintext,
                    isMe,
                    senderName,
                  };
                } catch (cachedErr) {
                  console.warn("⚠️ Cached key failed for group message");
                }
              }
            }

            // Strategy 2: Use sender's public key from message meta
            if (m.meta?.senderPublicKey) {
              try {
                const { aesKey: derived, rawKeyBase64 } = await cryptoLib.deriveSharedAESKey(
                  myPriv,
                  m.meta.senderPublicKey
                );
                plaintext = await cryptoLib.decryptWithAesKey(derived, m.ciphertext);
                if (senderId) {
                  cryptoLib.saveAesKeyForUser(senderId, rawKeyBase64);
                  setMemberKeys((prev) => ({ ...prev, [senderId]: derived }));
                }
                console.log("✅ Group message decrypted using sender's key from meta");
                return {
                  ...m,
                  plaintext,
                  isMe,
                  senderName,
                };
              } catch (metaErr) {
                console.warn("⚠️ Sender's key from meta failed for group message");
              }
            }

            // Strategy 3: Fetch sender's current public key from server
            if (senderId && !isMe) {
              try {
                const { data: senderUser } = await api.get(`/api/users/${senderId}`);
                if (senderUser?.ecdhPublicKey) {
                  const { aesKey: derived, rawKeyBase64 } = await cryptoLib.deriveSharedAESKey(
                    myPriv,
                    senderUser.ecdhPublicKey
                  );
                  plaintext = await cryptoLib.decryptWithAesKey(derived, m.ciphertext);
                  cryptoLib.saveAesKeyForUser(senderId, rawKeyBase64);
                  setMemberKeys((prev) => ({ ...prev, [senderId]: derived }));
                  senderName = senderUser.displayName || senderUser.username || "Unknown";
                  console.log("✅ Group message decrypted using sender's current key");
                  return {
                    ...m,
                    plaintext,
                    isMe,
                    senderName,
                  };
                }
              } catch (fetchErr) {
                console.warn("⚠️ Failed to fetch sender's key for group message");
              }
            }

            // All strategies failed
            console.error("❌ All decryption attempts failed for group message:", {
              id: m._id || m.id,
              senderId,
              isMe,
              hasMeta: !!m.meta,
              hasSenderPublicKey: !!m.meta?.senderPublicKey
            });
            return {
              ...m,
              plaintext: "[Decryption Error]",
              isMe,
              senderName,
            };
          })
        );

        // Merge pending messages (per-member) so locally-sent pending items are not lost
        const pendingEntries = Object.values(pendingMessagesRef.current || {}).map(p => ({
          tempId: p.tempId,
          senderId: myUserId,
          groupId: String(group._id),
          plaintext: p.plaintext,
          ciphertext: p.ciphertext,
          type: 'text',
          createdAt: new Date(),
          isMe: true,
          senderName: 'You'
        }));

        const merged = [...decrypted];
        pendingEntries.forEach(pe => {
          const exists = merged.some(d => d.ciphertext === pe.ciphertext || d.tempId === pe.tempId);
          if (!exists) merged.push(pe);
        });

        // Add any messages that arrived during the history load
        if (window.incomingMessagesDuringLoad && Array.isArray(window.incomingMessagesDuringLoad)) {
          window.incomingMessagesDuringLoad.forEach(msg => {
            const exists = merged.some(m => m._id === msg._id || (m.tempId && m.tempId === msg.tempId));
            if (!exists) {
              merged.push(msg);
            }
          });
        }

        setHistory(merged);
      } catch (err) {
        console.error("❌ Error loading group chat:", err);
        console.error("❌ Error details:", {
          message: err.message,
          response: err.response,
          request: err.request,
          config: err.config
        });
        toast.error(`Failed to load group messages: ${err.message}`);
      } finally {
        setLoading(false);
        isLoadingHistory = false;
        delete window.incomingMessagesDuringLoad;
      }
    })();

    // Cleanup: leave group room
    return () => {
      socket.emit("leaveGroup", String(group._id));
    };
  }, [group, socket, myUserId]);

  /* ---------- Incoming messages ---------- */
  useEffect(() => {
    if (!socket || !group) return;

    const handler = async (m) => {
      try {
        // Only process messages for this group
        if (String(m.groupId) !== String(group._id)) return;
        if (!m.ciphertext) return;

        const isMe = String(m.senderId) === String(myUserId);

        // Check if we're still loading history and capture incoming messages
        if (window.incomingMessagesDuringLoad && Array.isArray(window.incomingMessagesDuringLoad)) {
          // Check if this message is already in the captured array to prevent duplicates
          const alreadyCaptured = window.incomingMessagesDuringLoad.some(
            captured => captured._id === m._id || (captured.tempId && captured.tempId === m.tempId)
          );
          if (!alreadyCaptured) {
            window.incomingMessagesDuringLoad.push(m);
          }
          return;
        }

        // If message is explicitly unencrypted, show plaintext immediately
        if (m.meta?.unencrypted || (m.ciphertext && m.ciphertext.length < 29)) {
          let senderName = "Unknown";
          if (m.senderId && !isMe) {
            try {
              const { data: senderUser } = await api.get(`/api/users/${m.senderId}`);
              senderName = senderUser.displayName || senderUser.username || "Unknown";
            } catch (err) {
              console.warn("Failed to fetch sender name for plaintext message:", err.message);
            }
          } else if (isMe) {
            try {
              const { data: me } = await api.get('/api/users/me');
              senderName = me.displayName || me.username || 'You';
            } catch (err) {
              senderName = 'You';
            }
          }

          // Check if this is a file message
          const fileInfo = m.meta?.fileInfo || (m.meta?.url ? m.meta : null);
          if (m.type === "file" || fileInfo) {
            const info = fileInfo || m.meta || {};
            console.log("📥 File message received in group:", info);
            appendNewMessage({
              ...m,
              plaintext: info.isImage ? "🖼️ Image" : `📎 ${info.name || 'File'}`,
              type: "file",
              meta: {
                url: info.url,
                name: info.name,
                isImage: info.isImage,
                ...(m.meta || {})
              },
              isMe,
              senderName,
            });
            return;
          }

          appendNewMessage({
            ...m,
            plaintext: m.ciphertext,
            isMe,
            senderName,
          });
          return;
        }

        const myPriv = await loadLocalPrivateKey();
        if (!myPriv) {
          appendNewMessage({
            ...m,
            plaintext: "[Encrypted - no key]",
            isMe,
            senderName: "Unknown",
          });
          return;
        }

        let text = "[Decryption Error]";
        let senderName = "Unknown";

        // If this is an echoed copy of a message we just sent, and we have a pending entry, update instead of appending duplicate
        if (String(m.senderId) === String(myUserId)) {
          // Look up directly by ciphertext (robust against rapid sends)
          const pending = pendingMessagesRef.current[m.ciphertext];

          if (pending) {
            // Update the pending message in-place: remove tempId and keep server ciphertext/createdAt
            setHistory((prev) => prev.map((msg) => {
              if (msg.tempId && msg.tempId === pending.tempId) {
                return {
                  ...msg,
                  _id: m._id, // Add the server-assigned ID
                  ciphertext: m.ciphertext,
                  meta: { ...(msg.meta || {}), ...m.meta },
                  createdAt: m.createdAt || msg.createdAt,
                  tempId: undefined
                };
              }
              return msg;
            }));
            // Clear pending
            delete pendingMessagesRef.current[m.ciphertext];
            return; // don't continue to append duplicate
          }
        }

        // Try to decrypt using senderPublicKey in meta first
        let triedMeta = false;
        if (m.meta?.senderPublicKey) {
          triedMeta = true;
          try {
            const { aesKey: derived } = await cryptoLib.deriveSharedAESKey(
              myPriv,
              m.meta.senderPublicKey
            );
            text = await cryptoLib.decryptWithAesKey(derived, m.ciphertext);

            // Cache the key
            if (m.senderId) {
              const { rawKeyBase64 } = await cryptoLib.deriveSharedAESKey(
                myPriv,
                m.meta.senderPublicKey
              );
              cryptoLib.saveAesKeyForUser(m.senderId, rawKeyBase64);
              setMemberKeys((prev) => ({ ...prev, [m.senderId]: derived }));
            }

            // Fetch sender name
            if (m.senderId && !isMe) {
              try {
                const { data: senderUser } = await api.get(`/api/users/${m.senderId}`);
                senderName = senderUser.displayName || senderUser.username || "Unknown";
              } catch (err) {
                console.warn("Failed to fetch sender name:", err);
              }
            } else if (isMe) {
              try {
                const { data: me } = await api.get("/api/users/me");
                senderName = me.displayName || me.username || "You";
              } catch (err) {
                senderName = "You";
              }
            }
          } catch (err) {
            console.error("❌ Decryption with meta.senderPublicKey failed:", err);
          }
        }

        // If meta-based decryption failed (or meta missing), try fetching sender's current key
        if (!text && m.senderId && !isMe) {
          try {
            const { data: senderUser } = await api.get(`/api/users/${m.senderId}`);
            if (senderUser?.ecdhPublicKey) {
              try {
                const { aesKey: derived } = await cryptoLib.deriveSharedAESKey(myPriv, senderUser.ecdhPublicKey);
                text = await cryptoLib.decryptWithAesKey(derived, m.ciphertext);
                // Cache
                const { rawKeyBase64 } = await cryptoLib.deriveSharedAESKey(myPriv, senderUser.ecdhPublicKey);
                cryptoLib.saveAesKeyForUser(m.senderId, rawKeyBase64);
                setMemberKeys((prev) => ({ ...prev, [m.senderId]: derived }));
                senderName = senderUser.displayName || senderUser.username || "Unknown";
                console.log("✅ Group incoming message decrypted using fetched sender key");
              } catch (innerErr) {
                console.warn("⚠️ Decryption using fetched sender key failed:", innerErr);
              }
            }
          } catch (fetchErr) {
            console.warn("⚠️ Failed to fetch sender's key for incoming message:", fetchErr);
          }
        }

        appendNewMessage({
          ...m,
          plaintext: text,
          isMe,
          senderName,
        });
      } catch (err) {
        console.error("❌ Failed to handle incoming message:", err);
      }
    };

    socket.on("message", handler);

    // Handle send errors from the server
    const errorHandler = (error) => {
      console.error("❌ Server rejected message:", error);

      // Handle recipient_no_private_key for group sends: auto-resend unencrypted to that member
      if (error?.reason === 'recipient_no_private_key' && error?.receiverId) {
        const rid = String(error.receiverId);
        // Look up pending message by receiverId (scan values since we now key by ciphertext)
        const pendingKey = Object.keys(pendingMessagesRef.current).find(key => {
          const val = pendingMessagesRef.current[key];
          return val.receiverId === rid;
        });
        const pending = pendingKey ? pendingMessagesRef.current[pendingKey] : null;

        if (pending && pending.tempId) {
          // Update the pending message in-place (mark unencrypted)
          setHistory((prev) => prev.map((msg) => {
            if (msg.tempId && msg.tempId === pending.tempId) {
              return {
                ...msg,
                ciphertext: pending.plaintext, // fallback to plaintext as ciphertext
                meta: { ...(msg.meta || {}), unencrypted: true },
                tempId: undefined
              };
            }
            return msg;
          }));

          // Emit unencrypted message for that member
          socket.emit('sendMessage', {
            receiverId: rid,
            groupId: String(group._id),
            ciphertext: pending.plaintext,
            type: 'text',
            meta: { unencrypted: true }
          });

          // Clear pending
          delete pendingMessagesRef.current[pendingKey];

          // Silent resend - no toast (UI shows updated message)
          return;
        } else {
          // No pending entry for that receiver - inform the sender to retry manually
          toast.error('Recipient cannot decrypt encrypted messages; please resend to that member without encryption.');
          return;
        }
      }

      toast.error(`❌ Message failed: ${error.message || error.reason}`);
    };

    socket.on("errorSending", errorHandler);

    return () => {
      socket.off("message", handler);
      socket.off("errorSending", errorHandler);
    };
  }, [socket, group, myUserId]);

  /* ---------- Auto-scroll ---------- */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  /* ---------- Send message ---------- */
  async function send() {
    if (!text.trim()) return;

    try {
      // Ensure we have encryption keys available
      let myPublicKey = cryptoLib.getLocalPublicKey();
      let myPriv = await loadLocalPrivateKey();

      // If keys are not available, try to generate them
      if (!myPublicKey || !myPriv) {
        console.log('ℹ️ Generating new encryption keys...');

        // Check if Web Crypto is available
        const hasWebCrypto = window.crypto && window.crypto.subtle;

        if (hasWebCrypto) {
          try {
            const { privB64, pubB64 } = await cryptoLib.generateECDHKeyPair();
            myPublicKey = pubB64;
            myPriv = await cryptoLib.loadLocalPrivateKey(); // Load the newly generated private key

            // Upload the new public key to server
            try {
              await api.post('/api/auth/uploadKey', { ecdhPublicKey: pubB64 });
              console.log('✅ New public key uploaded to server');
            } catch (uploadErr) {
              console.warn('⚠️ Failed to upload new key to server (non-critical):', uploadErr);
            }
          } catch (genErr) {
            console.error('❌ Failed to generate encryption keys with Web Crypto:', genErr);
            // Fall back to backend key generation
          }
        }

        // If Web Crypto is not available or failed, use backend key generation
        if (!myPublicKey || !myPriv) {
          try {
            console.log('ℹ️ Web Crypto not available, generating keys on backend...');
            const response = await api.post('/api/auth/generateKeys');
            if (response.data && response.data.publicKey && response.data.privateKey) {
              myPublicKey = response.data.publicKey;
              // Store the private key in localStorage
              localStorage.setItem('ecdhPrivateKey', response.data.privateKey);
              localStorage.setItem('ecdhPublicKey', response.data.publicKey);
              myPriv = await cryptoLib.loadLocalPrivateKey(); // Load the newly stored private key
              console.log('✅ Keys generated on backend and stored locally');
            } else {
              throw new Error('Backend key generation did not return expected data');
            }
          } catch (backendErr) {
            console.error('❌ Failed to generate encryption keys on backend:', backendErr);
            toast.error('Failed to generate encryption keys. Please check your connection and try again.');
            return;
          }
        }
      }

      // Use group key for encryption if available
      let ciphertext = text;
      let isEncrypted = false;

      const cachedGroupKey = cryptoLib.getCachedGroupKey(String(group._id));
      if (cachedGroupKey) {
        try {
          ciphertext = await cryptoLib.encryptWithAesKey(cachedGroupKey, text);
          isEncrypted = true;
          console.log("🔐 Message encrypted with group key");
        } catch (encErr) {
          console.warn("⚠️ Failed to encrypt, sending unencrypted:", encErr.message);
        }
      }

      // Create a pending entry for optimistic UI update
      const broadcastTempId = `pending:group:${group._id}:${Date.now()}`;

      // Store pending by the plaintext
      pendingMessagesRef.current[text] = {
        tempId: broadcastTempId,
        plaintext: text,
        ciphertext: ciphertext,
      };

      appendNewMessage({
        tempId: broadcastTempId,
        senderId: myUserId,
        groupId: String(group._id),
        plaintext: text,
        ciphertext: ciphertext,
        type: 'text',
        createdAt: new Date(),
        isMe: true,
        senderName: 'You',
      });

      socket.emit("sendMessage", {
        groupId: String(group._id),
        ciphertext: ciphertext,
        type: "text",
        meta: {
          unencrypted: !isEncrypted,
          senderPublicKey: myPublicKey || null,
        },
      });

      console.log(`📡 Sent group message to group:${group._id} (encrypted: ${isEncrypted})`);

      setText("");
    } catch (err) {
      console.error("❌ Failed to send:", err);
      toast.error("Failed to send message");
    }
  }

  /* ---------- File upload ---------- */
  async function handleFiles(files) {
    if (!files.length) return;

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
              groupId: String(group._id),
              plaintext: isImage ? "🖼️ Image" : `📎 ${file.name}`,
              type: "file",
              meta: { url, name: file.name, isImage },
              createdAt: new Date(),
              isMe: true,
              senderName: "You",
            });

            let myPublicKey = cryptoLib.getLocalPublicKey();
            if (!myPublicKey) {
              try {
                const { data: me } = await api.get('/api/users/me');
                if (me?.ecdhPublicKey) myPublicKey = me.ecdhPublicKey;
              } catch (err) {
                console.warn('Failed to fetch own public key for file send fallback', err);
              }
            }

            // Send a single file notification to the group (true broadcast)
            socket.emit("sendMessage", {
              // NO receiverId - broadcast to group room
              groupId: String(group._id),
              ciphertext: isImage ? `🖼️ Image: ${file.name}` : `📎 File: ${file.name}`,
              type: "file",
              meta: {
                unencrypted: true,
                url: url,
                name: file.name,
                isImage: isImage,
                senderPublicKey: myPublicKey || null,
              },
            });

            console.log(`📡 Sent file message to group:${group._id}`);
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
        <span>👥 {group.name}</span>
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
                  className={`max-w-xs sm:max-w-md p-2 rounded-lg shadow text-sm ${m.isMe
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 text-gray-800"
                    }`}
                >
                  {!m.isMe && (
                    <div className="text-xs font-semibold mb-1 opacity-80">
                      {m.senderName}
                    </div>
                  )}
                  {m.type === "file" && m.meta?.url ? (
                    m.meta.isImage ? (
                      <a href={m.meta.url} target="_blank" rel="noreferrer">
                        <img
                          src={m.meta.url}
                          alt={m.meta.name}
                          className="rounded max-h-60 object-contain cursor-pointer hover:opacity-90"
                        />
                      </a>
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
                  <div className="text-xs opacity-70 mt-1">
                    {new Date(m.createdAt).toLocaleTimeString()}
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
      <div className="p-3 border-t flex gap-2 bg-gray-50 sticky bottom-0">
        <div className="flex items-center space-x-2">
          <FileUpload
            onFileUploaded={(file) => {
              // When a file is uploaded via FileUpload component, 
              // the component now handles sending to the group
              console.log(`📁 File uploaded to group: ${file.filename}`);
            }}
            socket={socket}
            myUserId={myUserId}
            groupId={group._id}  // Use groupId for group file uploads
            aesKey={null} // No AES key for group file uploads
          />
        </div>
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
    </div>
  );
}
