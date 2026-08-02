// frontend/src/pages/Chat.jsx
import React, { useEffect, useState, useRef } from "react";
import api, { setToken } from "../services/api";
import io from "socket.io-client";
import ChatWindow from "../components/ChatWindow";
import GroupChatWindow from "../components/GroupChatWindow";
import NotificationBell from "../components/NotificationBell";
import AdminPanel from "../pages/AdminPanel";
import { Menu, Settings, ArrowLeft, RefreshCw, Search, User, Users, Shield, LogOut, KeyRound, ShieldCheck, Sparkles, MessageSquare } from "lucide-react";
import { toast } from "react-toastify";
import * as cryptoLib from "../lib/crypto";

export default function Chat({ token, onLogout, onSettingsClick }) {
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [currentUser, setCurrentUser] = useState(null); // ✅ logged-in user
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const [onlineUsers, setOnlineUsers] = useState([]);
  const [lastSeen, setLastSeen] = useState({});
  const [systemMessages, setSystemMessages] = useState([]); // ✅ For optional welcome messages
  const socketRef = useRef();

  // Resizable sidebar state
  const [sidebarWidth, setSidebarWidth] = useState(288); // Default: 288px (w-72)
  const isResizing = useRef(false);
  const sidebarRef = useRef(null);

  // Unread message counts: separate maps for direct user chats and groups
  const [unreadUsers, setUnreadUsers] = useState({}); // userId -> count
  const [unreadGroups, setUnreadGroups] = useState({}); // groupId -> count

  const incrementUnreadUser = (userId) => {
    setUnreadUsers((prev) => ({ ...prev, [userId]: (prev[userId] || 0) + 1 }));
  };
  const incrementUnreadGroup = (groupId) => {
    setUnreadGroups((prev) => ({ ...prev, [groupId]: (prev[groupId] || 0) + 1 }));
  };
  const clearUnreadUser = (userId) => {
    setUnreadUsers((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    if (socketRef.current) socketRef.current.emit('markRead', { otherId: userId });
  };
  const clearUnreadGroup = (groupId) => {
    setUnreadGroups((prev) => {
      const next = { ...prev };
      delete next[groupId];
      return next;
    });
    if (socketRef.current) socketRef.current.emit('markRead', { groupId });
  };

  // Ask for Notification permission once (if supported)
  useEffect(() => {
    try {
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().then((p) => console.log('Notification permission:', p));
      }
    } catch (err) {
      console.warn('Notifications not available:', err.message);
    }
  }, []);

  useEffect(() => {
    setToken(token);
    
    // ✅ HEAL: Force sync local public key with backend to repair any stale DB state
    const localPub = localStorage.getItem("ecdhPublicKey");
    if (localPub) {
      api.post('/api/auth/uploadKey', { ecdhPublicKey: localPub }).catch(e => console.warn('Key sync skip:', e.message));
    }

    let mounted = true;
    const currentUserRef = { current: null }; // will be updated below

    async function init() {
      try {
        const { data: me } = await api.get("/api/users/me");
        if (!mounted) return;
        setCurrentUser(me);
        currentUserRef.current = me;

        const { data: allUsers } = await api.get("/api/users");
        if (!mounted) return;
        setUsers(allUsers);

        // Load groups the user is a member of
        const { data: userGroups } = await api.get("/api/users/groups/mine");
        if (!mounted) return;
        setGroups(userGroups);
      } catch (err) {
        console.error("Failed to load users/groups", err);

        // Check if it's a network error vs auth error
        if (!err.response) {
          // Network error
          toast.error("❌ Cannot reach backend server. Please check your connection and try again.", {
            autoClose: false,
            closeButton: true
          });
        } else if (err.response.status === 401) {
          // Unauthorized - token expired
          console.log("🔑 Token expired, logging out");
          onLogout();
        }
      }
    }
    init();

    // Determine socket server URL (same logic as API client)
    const getSocketUrl = () => {
      const envBase = import.meta.env.VITE_API_BASE;
      if (envBase && envBase.trim()) {
        return envBase;
      }
      const hostname = window.location.hostname;
      const protocol = window.location.protocol;
      if (hostname === "localhost" || hostname === "127.0.0.1") {
        return "http://localhost:5000";
      }
      return `${protocol}//${hostname}:5000`;
    };

    const socket = io(getSocketUrl(), {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5
    });
    socketRef.current = socket;

    // Report client capabilities (hasPrivateKey, hasWebCrypto) once connected
    (async () => {
      try {
        const hasWebCrypto = !!(window.crypto && window.crypto.subtle);
        let hasPrivateKey = false;
        if (hasWebCrypto && localStorage.getItem('ecdhPrivateKey')) {
          try {
            const raw = Uint8Array.from(atob(localStorage.getItem('ecdhPrivateKey')), c => c.charCodeAt(0)).buffer;
            await window.crypto.subtle.importKey('pkcs8', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
            hasPrivateKey = true;
          } catch (e) {
            console.warn('⚠️ Found stored private key but import failed:', e.message);
            hasPrivateKey = false;
          }
        }
        socket.emit('capabilities', { hasPrivateKey, hasWebCrypto });
        console.log('⚙️ Capabilities reported to server:', { hasPrivateKey, hasWebCrypto });
      } catch (err) {
        console.warn('⚠️ Failed to report capabilities:', err.message);
      }
    })();

    // Handlers (named so cleanup works reliably)
    const onUserNew = (newUser) => {
      console.log("👤 New user joined:", newUser);
      setUsers((prev) => {
        if (prev.some((u) => u._id === newUser._id)) return prev;
        return [...prev, newUser];
      });
    };

    const onUserAdded = onUserNew; // support multiple event names
    const onUserUpdated = (updated) => {
      console.log("🔁 user updated:", updated);
      setUsers((prev) => prev.map((u) => (u._id === updated._id ? { ...u, ...updated } : u)));
      // If the updated user is the current user, refresh currentUser
      if (currentUserRef.current && String(currentUserRef.current._id) === String(updated._id)) {
        setCurrentUser((prev) => ({ ...prev, ...updated }));
        currentUserRef.current = { ...currentUserRef.current, ...updated };
      }
    };

    const onUserDeleted = (deleted) => {
      console.log("🗑️ User deleted:", deleted);
      // Handle different payload formats
      const deletedUserId = deleted._id || deleted.id;
      if (!deletedUserId) {
        console.error("❌ Invalid deleted user payload:", deleted);
        return;
      }

      if (currentUserRef.current && String(currentUserRef.current._id) === String(deletedUserId)) {
        // If our own account was removed -> force logout
        alert("⚠️ Your account has been removed by an admin.");
        handleLogout();
      } else {
        setUsers((prev) => prev.filter((u) => u._id !== deletedUserId));
        // if currently selected user was deleted, clear selection
        setSelectedUser((sel) => (sel && sel._id === deletedUserId ? null : sel));
      }
    };

    const onOnlineUsers = ({ online, lastSeen }) => {
      setOnlineUsers(online || []);
      setLastSeen(lastSeen || {});
    };

    const onMessage = (msg) => {
      // System messages -> toast immediately
      if (msg?.type === "system") {
        console.log("💬 System message:", msg.ciphertext);
        toast.info(`💬 ${msg.ciphertext}`, {
          toastId: msg._id || `system-${(msg.createdAt || Date.now())}`,
          position: "top-right",
          autoClose: 5000,
        });
        return;
      }

      // Ignore malformed messages
      if (!msg) return;

      // Normalize id
      msg._id = msg._id || msg.id;

      const isGroup = !!msg.groupId;
      const senderIsMe = String(msg.senderId) === String(currentUser?._id);

      // Only consider incoming messages (not ones we sent)
      if (senderIsMe) return;

      // Helper to show browser notification (if permission granted)
      const showBrowserNotification = (title, body) => {
        try {
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification(title, { body });
          }
        } catch (err) {
          console.warn('Failed to show browser notification:', err.message);
        }
      };

      // Compose a user-friendly body: prefer plaintext when message is unencrypted or ciphertext short
      const readableBody = (m) => {
        if (!m) return 'New message';
        if (m.meta?.unencrypted) return m.ciphertext;
        if (m.ciphertext && m.ciphertext.length < 29) return m.ciphertext;
        return 'Encrypted message';
      };

      if (isGroup) {
        // Group message
        const gid = String(msg.groupId);
        const isActiveGroup = selectedGroup && String(selectedGroup._id) === gid && document.visibilityState === 'visible';
        if (!isActiveGroup) {
          incrementUnreadGroup(gid);
          const group = groups.find((g) => String(g._id) === gid);
          showBrowserNotification(group ? `Group: ${group.name}` : 'Group message', readableBody(msg));
        }
      } else if (msg.receiverId) {
        // Direct message: incoming when senderId !== me
        const sid = String(msg.senderId);
        const isActiveUser = selectedUser && String(selectedUser._id) === sid && document.visibilityState === 'visible';
        if (!isActiveUser) {
          incrementUnreadUser(sid);
          const user = users.find((u) => String(u._id) === sid);
          showBrowserNotification(user ? (user.displayName || user.username) : 'New message', readableBody(msg));
        }
      }
    };

    const onGroupAdded = async () => {
      console.log("👥 Group added, refreshing groups...");
      try {
        const { data: userGroups } = await api.get("/api/users/groups/mine");
        if (mounted) {
          setGroups(userGroups);
        }
      } catch (err) {
        console.error("Failed to refresh groups", err);
      }
    };

    const onGroupUpdated = async () => {
      console.log("👥 Group updated, refreshing groups...");
      try {
        const { data: userGroups } = await api.get("/api/users/groups/mine");
        if (mounted) {
          setGroups(userGroups);
          // If the updated group is currently selected, refresh it
          if (selectedGroup) {
            const updatedGroup = userGroups.find(g => g._id === selectedGroup._id);
            if (updatedGroup) {
              setSelectedGroup(updatedGroup);
            }
          }
        }
      } catch (err) {
        console.error("Failed to refresh groups", err);
      }
    };

    const onGroupDeleted = (deleted) => {
      console.log("🗑️ Group deleted:", deleted);
      setGroups((prev) => prev.filter((g) => g._id !== deleted.id));
      // If the deleted group was selected, clear selection
      if (selectedGroup && selectedGroup._id === deleted.id) {
        setSelectedGroup(null);
        setSelectedUser(null);
      }
    };

    // reconnect handler: re-fetch users and groups to avoid missing state
    const onReconnect = async () => {
      console.log("🔄 Socket reconnected, refreshing user list and groups...");
      try {
        const { data: allUsers } = await api.get("/api/users");
        setUsers(allUsers);
        const { data: userGroups } = await api.get("/api/users/groups/mine");
        setGroups(userGroups);
      } catch (err) {
        console.error("Failed to refresh users/groups after reconnect", err);
      }
    };


    // Register listeners (support several event names so server/both sides are fine)
    socket.on("user:new", onUserNew);
    socket.on("userAdded", onUserAdded);
    socket.on("user:added", onUserAdded);

    socket.on("user:updated", onUserUpdated);
    socket.on("userUpdated", onUserUpdated);

    socket.on("user:deleted", onUserDeleted);
    socket.on("userDeleted", onUserDeleted);

    socket.on("onlineUsers", onOnlineUsers);
    socket.on("message", onMessage);
    socket.on("groupAdded", onGroupAdded);
    socket.on("groupUpdated", onGroupUpdated);
    socket.on("groupDeleted", onGroupDeleted);

    socket.io.on("reconnect", onReconnect);

    // keep currentUserRef in sync whenever state changes
    const unsubscribeCurrentUser = () => { };
    // Note: easier to update ref inside any setCurrentUser call site in this file:
    // after you call setCurrentUser(me) earlier we set the ref. But also add this effect:
    // (we'll update the ref via a small helper below)

    // Cleanup
    return () => {
      mounted = false;
      socket.off("user:new", onUserNew);
      socket.off("userAdded", onUserAdded);
      socket.off("user:added", onUserAdded);
      socket.off("user:updated", onUserUpdated);
      socket.off("userUpdated", onUserUpdated);
      socket.off("user:deleted", onUserDeleted);
      socket.off("userDeleted", onUserDeleted);
      socket.off("onlineUsers", onOnlineUsers);
      socket.off("message", onMessage);
      socket.off("groupAdded", onGroupAdded);
      socket.off("groupUpdated", onGroupUpdated);
      socket.off("groupDeleted", onGroupDeleted);
      socket.io.off("reconnect", onReconnect);
      socket.disconnect();
      // ensure ref cleared
      currentUserRef.current = null;
      unsubscribeCurrentUser();
    };
  }, [token]); // keep dependency on token only

  // When the tab becomes visible, clear unread count for the active chat (user or group)
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (selectedUser) clearUnreadUser(selectedUser._id);
        if (selectedGroup) clearUnreadGroup(selectedGroup._id);
      }
    };
    window.addEventListener('visibilitychange', onVisibility);
    return () => window.removeEventListener('visibilitychange', onVisibility);
  }, [selectedUser, selectedGroup]);



  function handleLogout() {
    localStorage.removeItem("token");
    onLogout();
  }

  async function handleResetKeys() {
    if (!window.confirm("WARNING: This will forcefully generate new encryption keys and PURGE your current local ones. Your previous encrypted messages may become permanently unreadable (if they aren't already). Only do this if you have persistent 'OperationError' decryption issues.\n\nProceed?")) {
      return;
    }
    try {
      toast.info("Generating new secure keys...");
      const { pubB64 } = await cryptoLib.generateECDHKeyPair();
      await api.post('/api/auth/uploadKey', { ecdhPublicKey: pubB64 });
      
      // Clear entire AES cache
      localStorage.removeItem("aesKeys");
      
      toast.success("Security keys successfully regenerated & synced! Refreshing...", { autoClose: 2500 });
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      console.error(err);
      toast.error("Failed to reset keys.");
    }
  }

  function formatLastSeen(ts) {
    if (!ts) return "offline";
    const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
    if (diff < 60) return "last seen just now";
    if (diff < 3600) return `last seen ${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `last seen ${Math.floor(diff / 3600)}h ago`;
    return `last seen ${Math.floor(diff / 86400)}d ago`;
  }
  // Check if we have an active chat (for mobile view switching)
  const hasActiveChat = selectedUser || selectedGroup || showAdminPanel;

  // Sidebar resize handlers
  const startResizing = (e) => {
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing.current) return;

      const newWidth = e.clientX;
      // Constrain width between 200px and 500px
      if (newWidth >= 200 && newWidth <= 500) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Filter users and groups based on search term
  const filteredUsers = users.filter((u) => {
    const query = searchTerm.toLowerCase();
    return (
      (u.displayName && u.displayName.toLowerCase().includes(query)) ||
      (u.username && u.username.toLowerCase().includes(query))
    );
  });

  const filteredGroups = groups.filter((g) => {
    return g.name && g.name.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const getInitials = (name) => {
    if (!name) return "?";
    return name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
  };

  return (
    <div className="h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden font-sans">
      {/* Sidebar Container */}
      <div className="relative h-full" style={{ width: window.innerWidth >= 1024 ? sidebarWidth : '100%' }}>
        <aside
          ref={sidebarRef}
          className={`bg-white dark:bg-slate-900 w-full h-full border-r border-slate-200/80 dark:border-slate-800/80 p-4 z-40 lg:relative flex flex-col justify-between ${
            hasActiveChat ? 'hidden lg:flex' : 'flex'
          }`}
        >
          {/* Top Brand & Profile Header */}
          <div className="flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white font-bold shadow-md shadow-indigo-500/20">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-bold text-base text-slate-900 dark:text-white leading-tight flex items-center gap-1.5">
                    SecureChat
                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {currentUser?.displayName || currentUser?.username || "Connected"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <NotificationBell socket={socketRef.current} />
                <button
                  onClick={onSettingsClick}
                  className="p-2 rounded-xl text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  title="Settings"
                >
                  <Settings size={19} />
                </button>
              </div>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search messages or people..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-100 dark:bg-slate-800/80 border border-transparent focus:border-indigo-500/50 dark:focus:border-indigo-400/50 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:bg-white dark:focus:bg-slate-800 transition-all"
              />
            </div>
          </div>

          {/* Contacts & Groups Lists */}
          <div className="flex-1 overflow-y-auto my-4 space-y-6 pr-1">
            {/* Direct Messages Section */}
            <div>
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2.5 px-1">
                <span className="flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" /> Direct Messages ({filteredUsers.length})
                </span>
              </div>
              <div className="space-y-1">
                {filteredUsers.map((u) => {
                  const isOnline = onlineUsers.includes(u._id);
                  const isMe = currentUser?._id === u._id;
                  const isSelected = selectedUser?._id === u._id;

                  return (
                    <div
                      key={u._id}
                      className={`group relative p-2.5 rounded-xl transition-all duration-150 flex items-center justify-between cursor-pointer ${
                        isMe
                          ? "bg-slate-50 dark:bg-slate-800/40 opacity-75 cursor-default"
                          : isSelected
                          ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-950 dark:text-indigo-100 font-medium shadow-sm border border-indigo-200/50 dark:border-indigo-800/50"
                          : "hover:bg-slate-100/80 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300"
                      }`}
                      onClick={() => {
                        if (!isMe) {
                          setSelectedUser(u);
                          setSelectedGroup(null);
                          setShowAdminPanel(false);
                          setSidebarOpen(false);
                          clearUnreadUser(u._id);
                        }
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* User Avatar with Online Dot */}
                        <div className="relative flex-shrink-0">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold ${
                            isSelected
                              ? "bg-indigo-600 text-white"
                              : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                          }`}>
                            {getInitials(u.displayName || u.username)}
                          </div>
                          <span
                            className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${
                              isOnline ? "bg-emerald-500" : "bg-slate-400"
                            }`}
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <span className="truncate text-sm font-semibold">
                              {u.displayName || u.username}
                            </span>
                            {isMe && (
                              <span className="text-[10px] bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-400 font-medium">You</span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                            {isOnline ? "Online" : formatLastSeen(lastSeen[u._id])}
                          </p>
                        </div>
                      </div>

                      {/* Unread badge */}
                      {unreadUsers[u._id] > 0 && (
                        <span className="bg-indigo-600 text-white text-[10px] font-bold rounded-full h-5 min-w-[20px] px-1.5 flex items-center justify-center">
                          {unreadUsers[u._id] > 99 ? '99+' : unreadUsers[u._id]}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Groups Section */}
            <div>
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2.5 px-1">
                <span className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" /> Groups ({filteredGroups.length})
                </span>
              </div>
              <div className="space-y-1">
                {filteredGroups.length === 0 ? (
                  <p className="text-xs text-slate-400 dark:text-slate-600 p-2 italic">No groups found</p>
                ) : (
                  filteredGroups.map((g) => {
                    const isSelected = selectedGroup?._id === g._id;
                    return (
                      <div
                        key={g._id}
                        className={`p-2.5 rounded-xl transition-all duration-150 flex items-center justify-between cursor-pointer ${
                          isSelected
                            ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-950 dark:text-indigo-100 font-medium shadow-sm border border-indigo-200/50 dark:border-indigo-800/50"
                            : "hover:bg-slate-100/80 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300"
                        }`}
                        onClick={() => {
                          setSelectedGroup(g);
                          setSelectedUser(null);
                          setShowAdminPanel(false);
                          setSidebarOpen(false);
                          clearUnreadGroup(g._id);
                        }}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-semibold ${
                            isSelected
                              ? "bg-purple-600 text-white"
                              : "bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300"
                          }`}>
                            👥
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="truncate text-sm font-semibold block">
                              {g.name}
                            </span>
                            <p className="text-[11px] text-slate-400 dark:text-slate-500">
                              {g.members?.length || 0} members
                            </p>
                          </div>
                        </div>

                        {unreadGroups[g._id] > 0 && (
                          <span className="bg-purple-600 text-white text-[10px] font-bold rounded-full h-5 min-w-[20px] px-1.5 flex items-center justify-center">
                            {unreadGroups[g._id] > 99 ? '99+' : unreadGroups[g._id]}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Bottom Action Footer */}
          <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800/80 space-y-2">
            {currentUser?.role === "admin" && (
              <button
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-2 shadow-sm transition-all"
                onClick={() => {
                  setShowAdminPanel(true);
                  setSelectedUser(null);
                  setSelectedGroup(null);
                  setSidebarOpen(false);
                }}
              >
                <Shield size={15} />
                Open Admin Panel
              </button>
            )}

            <div className="flex gap-2">
              <button
                className="flex-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300/40 dark:border-amber-700/40 font-medium py-2 px-2 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all"
                onClick={handleResetKeys}
                title="Reset encryption keys"
              >
                <RefreshCw size={14} />
                Reset Keys
              </button>
              <button
                className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-300/40 dark:border-rose-800/40 font-medium py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all"
                onClick={handleLogout}
              >
                <LogOut size={14} />
                Logout
              </button>
            </div>
          </div>
        </aside>

        {/* Sidebar Drag Resizer Handle */}
        <div
          className="hidden lg:block absolute top-0 right-0 w-1 h-full cursor-col-resize bg-transparent hover:bg-indigo-500 transition-colors z-50"
          onMouseDown={startResizing}
          title="Drag to resize sidebar"
        />
      </div>

      {/* Mobile Chat Header */}
      {hasActiveChat && (
        <div className="lg:hidden fixed top-0 left-0 w-full h-14 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 flex items-center px-3 z-50 shadow-xs">
          <button
            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 mr-2 text-slate-600 dark:text-slate-300 active:scale-95 transition-all"
            onClick={() => {
              setSelectedUser(null);
              setSelectedGroup(null);
              setShowAdminPanel(false);
            }}
          >
            <ArrowLeft size={20} />
          </button>
          <h2 className="font-bold text-sm text-slate-900 dark:text-white flex-1 truncate">
            {showAdminPanel ? 'Admin Panel' : selectedGroup?.name || selectedUser?.displayName || selectedUser?.username || 'Chat'}
          </h2>
          <div className="flex items-center gap-1">
            <NotificationBell socket={socketRef.current} />
            <button
              className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
              onClick={onSettingsClick}
            >
              <Settings size={20} />
            </button>
          </div>
        </div>
      )}

      {/* Main Chat Content Area */}
      <main className={`flex-1 overflow-hidden h-full flex flex-col ${hasActiveChat ? 'flex pt-14 lg:pt-0' : 'hidden lg:flex'}`}>
        {systemMessages.length > 0 && (
          <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/50 p-2.5 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            {systemMessages.map((m, i) => (
              <span key={i}>{m.ciphertext}</span>
            ))}
          </div>
        )}

        {showAdminPanel ? (
          <AdminPanel />
        ) : selectedGroup ? (
          <GroupChatWindow
            group={selectedGroup}
            socket={socketRef.current}
            myUserId={currentUser?._id}
          />
        ) : selectedUser ? (
          <ChatWindow
            other={selectedUser}
            socket={socketRef.current}
            myUserId={currentUser?._id}
            currentUser={currentUser}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50 dark:bg-slate-950">
            <div className="w-20 h-20 bg-indigo-100 dark:bg-slate-900 rounded-3xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-4 shadow-inner">
              <MessageSquare className="w-10 h-10" />
            </div>
            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">
              End-to-End Encrypted Chat
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
              Select a contact or group from the sidebar to begin messaging with full privacy.
            </p>
            <div className="mt-6 flex items-center gap-2 text-xs text-slate-400 dark:text-slate-600">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              AES-256 & ECDH Key Exchange Protected
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
