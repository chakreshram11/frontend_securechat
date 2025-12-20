// frontend/src/components/GroupChatWindow.jsx
import React, { useEffect, useState, useRef } from "react";
import api from "../services/api";
import * as cryptoLib from "../lib/crypto";
import { toast } from "react-toastify";
import { loadLocalPrivateKey } from "./ChatWindow";

export default function GroupChatWindow({ group, socket, myUserId }) {
  const [history, setHistory] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploadingFiles, setUploadingFiles] = useState([]);
  const [memberKeys, setMemberKeys] = useState({}); // userId -> AES key
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef();

  const appendNewMessage = (m) => setHistory((prev) => [...prev, m]);

  /* ---------- Join group room and load history ---------- */
  useEffect(() => {
    if (!socket || !group) return;

    // Join the group room
    socket.emit("joinGroup", String(group._id));

    (async () => {
      try {
        setLoading(true);

        // Load group message history
        const { data } = await api.get(`/api/messages/group/${String(group._id)}`);
        
        const myPriv = await loadLocalPrivateKey();
        if (!myPriv) {
          toast.error("⚠️ Missing encryption key. Please log out and log back in.");
          setLoading(false);
          return;
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

            // Strategy 1: Try cached AES key for this sender
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

        setHistory(decrypted);
      } catch (err) {
        console.error("❌ Error loading group chat:", err);
        toast.error("Failed to load group messages");
      } finally {
        setLoading(false);
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
        const myPriv = await loadLocalPrivateKey();
        if (!myPriv) {
          appendNewMessage({
            ...m,
            plaintext: "[Decryption Error - No Key]",
            isMe,
            senderName: "Unknown",
          });
          return;
        }

        let text = "[Decryption Error]";
        let senderName = "Unknown";

        // Try to decrypt
        if (m.meta?.senderPublicKey) {
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
              // For our own messages, we know our name
              try {
                const { data: me } = await api.get("/api/users/me");
                senderName = me.displayName || me.username || "You";
              } catch (err) {
                senderName = "You";
              }
            }
          } catch (err) {
            console.error("❌ Decryption failed:", err);
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
    return () => socket.off("message", handler);
  }, [socket, group, myUserId]);

  /* ---------- Auto-scroll ---------- */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  /* ---------- Send message ---------- */
  async function send() {
    if (!text.trim()) return;

    try {
      const myPublicKey = cryptoLib.getLocalPublicKey();
      if (!myPublicKey) {
        toast.error("⚠️ Missing encryption key. Please log out and log back in.");
        return;
      }

      const myPriv = await loadLocalPrivateKey();
      if (!myPriv) {
        toast.error("⚠️ Missing private key.");
        return;
      }

      // For group messages, we encrypt using the first member's public key
      // All members can decrypt using their private key + sender's public key (from meta)
      // This is a simplified approach - in production, you'd want proper group key management
      let recipientPublicKey = null;
      
      // Find first member that's not us and has a public key
      if (group.members && group.members.length > 0) {
        for (const member of group.members) {
          const memberId = typeof member === 'object' ? member._id : member;
          if (String(memberId) !== String(myUserId)) {
            try {
              const { data: memberUser } = await api.get(`/api/users/${memberId}`);
              if (memberUser?.ecdhPublicKey) {
                recipientPublicKey = memberUser.ecdhPublicKey;
                break;
              }
            } catch (err) {
              console.warn("Failed to fetch member key:", err);
            }
          }
        }
      }

      // If no member has a key, we can't encrypt properly
      // For now, we'll use a placeholder approach
      if (!recipientPublicKey) {
        toast.warning("⚠️ No group members have encryption keys yet.");
        return;
      }

      // Derive AES key using our private key + first member's public key
      const { aesKey } = await cryptoLib.deriveSharedAESKey(
        myPriv,
        recipientPublicKey
      );
      
      const c = await cryptoLib.encryptWithAesKey(aesKey, text);

      appendNewMessage({
        senderId: myUserId,
        groupId: String(group._id),
        plaintext: text,
        ciphertext: c,
        type: "text",
        createdAt: new Date(),
        isMe: true,
        senderName: "You",
      });

      socket.emit("sendMessage", {
        groupId: String(group._id),
        ciphertext: c,
        type: "text",
        meta: {
          senderPublicKey: myPublicKey,
        },
      });

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

            const myPublicKey = cryptoLib.getLocalPublicKey();
            const myPriv = await loadLocalPrivateKey();
            if (myPriv && myPublicKey && group.members) {
              // Find first member with public key for encryption
              let recipientPublicKey = null;
              for (const member of group.members) {
                const memberId = typeof member === 'object' ? member._id : member;
                if (String(memberId) !== String(myUserId)) {
                  try {
                    const { data: memberUser } = await api.get(`/api/users/${memberId}`);
                    if (memberUser?.ecdhPublicKey) {
                      recipientPublicKey = memberUser.ecdhPublicKey;
                      break;
                    }
                  } catch (err) {
                    // Continue to next member
                  }
                }
              }
              
              if (recipientPublicKey) {
                const { aesKey } = await cryptoLib.deriveSharedAESKey(
                  myPriv,
                  recipientPublicKey
                );
                const c = await cryptoLib.encryptWithAesKey(aesKey, `File: ${file.name}`);

                socket.emit("sendMessage", {
                  groupId: String(group._id),
                  ciphertext: c,
                  type: "text",
                  meta: {
                    senderPublicKey: myPublicKey,
                  },
                });
              }
            }
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
                  className={`max-w-xs sm:max-w-md p-2 rounded-lg shadow text-sm ${
                    m.isMe
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



