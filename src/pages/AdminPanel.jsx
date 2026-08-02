import React, { useEffect, useState } from "react";
import api from "../services/api";
import { toast } from "react-toastify";
import { io } from "socket.io-client";
import {
  Users,
  UserPlus,
  Shield,
  ShieldCheck,
  Key,
  Trash2,
  Edit3,
  Search,
  Check,
  Plus,
  X,
  RefreshCw,
  Copy,
  Lock,
  MessageSquare,
  Sparkles,
  UserCheck,
  FolderPlus
} from "lucide-react";

export default function AdminPanel() {
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("users"); // "users" | "groups" | "create-user" | "create-group"

  // Search queries
  const [userSearch, setUserSearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");

  const [newUser, setNewUser] = useState({
    username: "",
    password: "",
    displayName: "",
    role: "user",
  });

  const [newGroup, setNewGroup] = useState({ name: "", members: [] });
  const [editingGroup, setEditingGroup] = useState(null);

  // Password reset modal state
  const [resetPasswordUser, setResetPasswordUser] = useState(null);
  const [newPassword, setNewPassword] = useState("");

  /* ---------- SOCKET.IO ---------- */
  useEffect(() => {
    const getSocketUrl = () => {
      const envBase = import.meta.env.VITE_API_BASE;
      if (envBase && envBase.trim()) return envBase;
      const hostname = window.location.hostname;
      const protocol = window.location.protocol;
      if (hostname === "localhost" || hostname === "127.0.0.1") {
        return "http://localhost:5000";
      }
      return `${protocol}//${hostname}:5000`;
    };

    const socket = io(getSocketUrl(), {
      auth: { token: localStorage.getItem("token") },
    });

    socket.on("user:new", (u) => {
      setUsers((prev) => (prev.some((x) => x._id === u._id) ? prev : [...prev, u]));
    });

    socket.on("userAdded", (u) => {
      setUsers((prev) => (prev.some((x) => x._id === u._id) ? prev : [...prev, u]));
    });

    socket.on("user:deleted", (deletedUser) => {
      const deletedUserId = deletedUser._id || deletedUser.id;
      if (deletedUserId) {
        setUsers((prev) => prev.filter((u) => u._id !== deletedUserId));
      }
    });

    socket.on("groupAdded", () => loadGroups());
    socket.on("groupUpdated", () => loadGroups());
    socket.on("groupDeleted", () => loadGroups());

    return () => {
      socket.off("user:new");
      socket.off("userAdded");
      socket.off("user:deleted");
      socket.off("groupAdded");
      socket.off("groupUpdated");
      socket.off("groupDeleted");
      socket.disconnect();
    };
  }, []);

  /* ---------- LOAD DATA ---------- */
  async function loadUsers() {
    try {
      const { data } = await api.get("/api/admin/users");
      setUsers(data);
    } catch {
      toast.error("❌ Failed to load users");
    }
  }

  async function loadGroups() {
    try {
      const { data } = await api.get("/api/admin/groups");
      setGroups(data);
    } catch {
      toast.error("❌ Failed to load groups");
    }
  }

  useEffect(() => {
    loadUsers();
    loadGroups();
  }, []);

  /* ---------- USER FUNCTIONS ---------- */
  async function addUser(e) {
    if (e) e.preventDefault();
    if (!newUser.username || !newUser.password) {
      return toast.warning("⚠️ Username & Password required");
    }
    setLoading(true);
    try {
      const { data } = await api.post("/api/admin/users", newUser);
      toast.success(`✅ User "${data.username}" created successfully`);
      setNewUser({ username: "", password: "", displayName: "", role: "user" });
      setUsers((prev) => [...prev, data]);
    } catch (err) {
      console.error("Add user error:", err.response?.data || err.message);
      toast.error(err.response?.data?.error || "❌ Failed to add user");
    } finally {
      setLoading(false);
    }
  }

  async function deleteUser(id, username) {
    if (!window.confirm(`Are you sure you want to delete user "${username}"?`)) return;
    try {
      await api.delete(`/api/admin/users/${id}`);
      toast.success("🗑️ User deleted");
      setUsers((prev) => prev.filter((u) => u._id !== id));
    } catch (err) {
      toast.error("❌ Failed to delete user");
    }
  }

  async function toggleUserRole(id, currentRole) {
    try {
      const newRole = currentRole === "admin" ? "user" : "admin";
      await api.put(`/api/admin/users/${id}`, { role: newRole });
      toast.success(`✅ Role updated to ${newRole}`);
      loadUsers();
    } catch {
      toast.error("❌ Failed to update role");
    }
  }

  async function resetUserPassword() {
    if (!resetPasswordUser || !newPassword) {
      toast.warning("⚠️ Please enter a new password");
      return;
    }
    if (newPassword.length < 6) {
      toast.warning("⚠️ Password must be at least 6 characters");
      return;
    }
    try {
      await api.post(`/api/admin/users/${resetPasswordUser._id}/reset-password`, {
        newPassword
      });
      toast.success(`✅ Password reset for ${resetPasswordUser.displayName || resetPasswordUser.username}`);
      setResetPasswordUser(null);
      setNewPassword("");
    } catch (err) {
      toast.error(err.response?.data?.error || "❌ Failed to reset password");
    }
  }

  function generateRandomPassword() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let pass = "";
    for (let i = 0; i < 10; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewPassword(pass);
  }

  function copyPasswordToClipboard() {
    if (!newPassword) return;
    navigator.clipboard.writeText(newPassword);
    toast.info("📋 Password copied to clipboard");
  }

  /* ---------- GROUP FUNCTIONS ---------- */
  async function addGroup(e) {
    if (e) e.preventDefault();
    if (!newGroup.name.trim()) return toast.warning("⚠️ Group name required");
    try {
      await api.post("/api/admin/groups", newGroup);
      toast.success(`✅ Group "${newGroup.name}" created`);
      setNewGroup({ name: "", members: [] });
      loadGroups();
    } catch {
      toast.error("❌ Failed to add group");
    }
  }

  async function deleteGroup(id, name) {
    if (!window.confirm(`Delete group "${name}"?`)) return;
    try {
      await api.delete(`/api/admin/groups/${id}`);
      toast.success("🗑️ Group deleted");
      loadGroups();
    } catch {
      toast.error("❌ Failed to delete group");
    }
  }

  async function saveGroupEdits() {
    if (!editingGroup) return;
    try {
      const membersToSend = Array.isArray(editingGroup.members)
        ? editingGroup.members.map((m) => (typeof m === "object" && m._id ? String(m._id) : String(m)))
        : [];

      await api.put(`/api/admin/groups/${editingGroup._id}`, {
        name: editingGroup.name,
        members: membersToSend,
      });
      toast.success("✅ Group updated successfully");
      setEditingGroup(null);
      loadGroups();
    } catch (err) {
      console.error("Failed to update group:", err);
      toast.error(err.response?.data?.error || "❌ Failed to update group");
    }
  }

  // Filtered Lists
  const filteredUsers = users.filter((u) => {
    const q = userSearch.toLowerCase();
    return (
      (u.username && u.username.toLowerCase().includes(q)) ||
      (u.displayName && u.displayName.toLowerCase().includes(q)) ||
      (u.role && u.role.toLowerCase().includes(q))
    );
  });

  const filteredGroups = groups.filter((g) => {
    return g.name && g.name.toLowerCase().includes(groupSearch.toLowerCase());
  });

  const adminCount = users.filter((u) => u.role === "admin").length;
  const standardUserCount = users.length - adminCount;

  return (
    <div className="bg-slate-50 dark:bg-slate-950 min-h-screen text-slate-900 dark:text-slate-100 font-sans pb-16 transition-colors duration-200">
      {/* 🔝 Sticky Top Navigation Header */}
      <header className="sticky top-0 z-20 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white font-bold shadow-md shadow-indigo-500/20">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white leading-tight flex items-center gap-2">
              Workspace Control Center
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Manage accounts, security permissions, and communication channels
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-800/40 shadow-xs">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            Real-time Sync Active
          </div>
        </div>
      </header>

      <main className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
        {/* 📊 KPI Dashboard Metrics Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 rounded-3xl p-5 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Total Users</p>
              <h3 className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">{users.length}</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                <span className="text-emerald-600 font-bold">{adminCount}</span> Admins • <span className="text-indigo-600 font-bold">{standardUserCount}</span> Standard
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Users className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 rounded-3xl p-5 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Group Channels</p>
              <h3 className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">{groups.length}</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Active team workspaces</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center">
              <MessageSquare className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 rounded-3xl p-5 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Security Layer</p>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mt-1 flex items-center gap-1.5">
                <ShieldCheck className="w-5 h-5 text-emerald-500" /> ECDH AES-256
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">End-to-End Key Exchange</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Lock className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* 🗂️ Interactive Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* USERS DIRECTORY PANEL */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-sm rounded-3xl p-6 flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-500" /> User Directory
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Manage accounts and toggle administrative roles
                </p>
              </div>

              {/* User Search Input */}
              <div className="relative w-full sm:w-48">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter users..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-indigo-500/50 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none"
                />
              </div>
            </div>

            {/* User Cards List */}
            <div className="space-y-2.5 overflow-y-auto max-h-96 pr-1">
              {filteredUsers.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs italic">
                  No users found matching search criteria.
                </div>
              ) : (
                filteredUsers.map((u) => (
                  <div
                    key={u._id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-2xl border border-slate-200/70 dark:border-slate-800/70 bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-100/60 dark:hover:bg-slate-800/70 transition-all gap-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shadow-xs ${
                        u.role === "admin"
                          ? "bg-gradient-to-tr from-emerald-500 to-teal-600 text-white"
                          : "bg-gradient-to-tr from-indigo-500 to-purple-600 text-white"
                      }`}>
                        {(u.displayName || u.username)[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-slate-900 dark:text-white">
                            {u.displayName || u.username}
                          </span>
                          {u.displayName && (
                            <span className="text-[11px] text-slate-400">(@{u.username})</span>
                          )}
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-extrabold rounded-full mt-0.5 ${
                            u.role === "admin"
                              ? "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300"
                              : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                          }`}
                        >
                          {u.role === "admin" && <ShieldCheck className="w-3 h-3 text-emerald-600 inline" />}
                          {u.role.toUpperCase()}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={() => toggleUserRole(u._id, u.role)}
                        className="px-2.5 py-1.5 text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300/40 dark:border-amber-700/40 rounded-xl transition-all flex items-center gap-1"
                        title="Toggle role between admin and user"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        Role
                      </button>
                      <button
                        onClick={() => setResetPasswordUser(u)}
                        className="px-2.5 py-1.5 text-xs font-semibold bg-purple-500/10 hover:bg-purple-500/20 text-purple-700 dark:text-purple-300 border border-purple-300/40 dark:border-purple-700/40 rounded-xl transition-all flex items-center gap-1"
                        title="Reset password for user"
                      >
                        <Key className="w-3.5 h-3.5" />
                        Reset
                      </button>
                      <button
                        onClick={() => deleteUser(u._id, u.username)}
                        className="px-2.5 py-1.5 text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-400 border border-rose-300/40 dark:border-rose-800/40 rounded-xl transition-all flex items-center gap-1"
                        title="Delete user account"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Form to Create New User */}
            <div className="mt-6 pt-5 border-t border-slate-200/80 dark:border-slate-800/80">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-indigo-500" /> Register New Account
              </h3>
              <form onSubmit={addUser} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2.5 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  placeholder="Username *"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  required
                />
                <input
                  className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2.5 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  type="password"
                  placeholder="Password *"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  required
                />
                <input
                  className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2.5 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 sm:col-span-2"
                  placeholder="Display Name (Optional)"
                  value={newUser.displayName}
                  onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
                />
                <select
                  className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2.5 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                >
                  <option value="user">Standard User</option>
                  <option value="admin">Administrator</option>
                </select>
                <button
                  type="submit"
                  disabled={loading}
                  className={`sm:col-span-2 py-2.5 px-4 rounded-xl text-xs font-semibold text-white shadow-md transition-all flex items-center justify-center gap-1.5 ${
                    loading
                      ? "bg-slate-400 cursor-not-allowed"
                      : "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-indigo-500/20 active:scale-98"
                  }`}
                >
                  <Plus className="w-4 h-4" />
                  {loading ? "Creating User..." : "Create User Account"}
                </button>
              </form>
            </div>
          </section>

          {/* GROUPS MANAGEMENT PANEL */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-sm rounded-3xl p-6 flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-purple-500" /> Group Channels
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Manage multi-user group chat spaces and members
                </p>
              </div>

              {/* Group Search Input */}
              <div className="relative w-full sm:w-48">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter groups..."
                  value={groupSearch}
                  onChange={(e) => setGroupSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-purple-500/50 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none"
                />
              </div>
            </div>

            {/* Groups Cards List */}
            <div className="space-y-3 overflow-y-auto max-h-96 pr-1">
              {filteredGroups.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs italic">
                  No groups found. Create one below!
                </div>
              ) : (
                filteredGroups.map((g) => (
                  <div
                    key={g._id}
                    className="p-4 border border-slate-200/70 dark:border-slate-800/70 bg-slate-50/60 dark:bg-slate-800/40 rounded-2xl space-y-3"
                  >
                    {editingGroup && editingGroup._id === g._id ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider flex items-center gap-1">
                            <Edit3 className="w-3.5 h-3.5" /> Edit Group Channel
                          </h4>
                        </div>
                        <input
                          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-2.5 rounded-xl w-full text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                          value={editingGroup.name}
                          onChange={(e) => setEditingGroup({ ...editingGroup, name: e.target.value })}
                          placeholder="Group Channel Name"
                        />

                        {/* Interactive Member Toggle Chips */}
                        <div>
                          <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-2 uppercase tracking-wider">
                            Toggle Group Members ({editingGroup.members.length} selected):
                          </label>
                          <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl">
                            {users.map((u) => {
                              const isMember = editingGroup.members.some(
                                (m) => String(m) === String(u._id)
                              );
                              return (
                                <button
                                  type="button"
                                  key={u._id}
                                  onClick={() => {
                                    setEditingGroup({
                                      ...editingGroup,
                                      members: isMember
                                        ? editingGroup.members.filter((id) => String(id) !== String(u._id))
                                        : [...editingGroup.members, String(u._id)],
                                    });
                                  }}
                                  className={`px-2.5 py-1 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all ${
                                    isMember
                                      ? "bg-purple-600 text-white shadow-xs"
                                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                                  }`}
                                >
                                  {isMember && <Check className="w-3 h-3" />}
                                  <span>{u.displayName || u.username}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={saveGroupEdits}
                            className="flex-1 py-2 px-3 bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-1"
                          >
                            <Check className="w-3.5 h-3.5" /> Save Changes
                          </button>
                          <button
                            onClick={() => setEditingGroup(null)}
                            className="flex-1 py-2 px-3 bg-slate-300 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs rounded-xl hover:bg-slate-400 dark:hover:bg-slate-700 transition-all"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-300 flex items-center justify-center text-sm font-bold">
                            👥
                          </div>
                          <div>
                            <span className="font-bold text-sm text-slate-900 dark:text-white block">
                              {g.name}
                            </span>
                            <span className="text-xs text-slate-400">
                              {g.members.length} members
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => {
                              const memberIds = g.members.map((m) =>
                                typeof m === "object" && m._id ? String(m._id) : String(m)
                              );
                              setEditingGroup({
                                _id: g._id,
                                name: g.name,
                                members: memberIds,
                              });
                            }}
                            className="px-2.5 py-1.5 text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300/40 dark:border-amber-700/40 rounded-xl transition-all flex items-center gap-1"
                          >
                            <Edit3 className="w-3.5 h-3.5" /> Edit
                          </button>
                          <button
                            onClick={() => deleteGroup(g._id, g.name)}
                            className="px-2.5 py-1.5 text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-400 border border-rose-300/40 dark:border-rose-800/40 rounded-xl transition-all flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Form to Create New Group */}
            <div className="mt-6 pt-5 border-t border-slate-200/80 dark:border-slate-800/80">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-purple-500" /> Create Group Channel
              </h3>
              <form onSubmit={addGroup} className="space-y-3">
                <input
                  className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2.5 rounded-xl text-xs w-full text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  placeholder="Group Channel Name *"
                  value={newGroup.name}
                  onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
                  required
                />

                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5">
                    Select Initial Members ({newGroup.members.length} selected):
                  </label>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl">
                    {users.map((u) => {
                      const isSelected = newGroup.members.includes(u._id);
                      return (
                        <button
                          type="button"
                          key={u._id}
                          onClick={() => {
                            setNewGroup({
                              ...newGroup,
                              members: isSelected
                                ? newGroup.members.filter((id) => id !== u._id)
                                : [...newGroup.members, u._id],
                            });
                          }}
                          className={`px-2.5 py-1 rounded-xl text-xs font-medium flex items-center gap-1 transition-all ${
                            isSelected
                              ? "bg-purple-600 text-white shadow-xs"
                              : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100"
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3" />}
                          <span>{u.displayName || u.username}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 shadow-md shadow-purple-500/20 active:scale-98 transition-all flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-4 h-4" /> Create Group Channel
                </button>
              </form>
            </div>
          </section>
        </div>
      </main>

      {/* 🔐 Reset Password Modal */}
      {resetPasswordUser && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-300">
                  <Key size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white leading-tight">
                    Reset Password
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    For user: <span className="font-semibold text-slate-900 dark:text-white">{resetPasswordUser.displayName || resetPasswordUser.username}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setResetPasswordUser(null);
                  setNewPassword("");
                }}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Enter new password (min 6 chars)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 pr-20 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 font-mono"
                />
                <button
                  type="button"
                  onClick={copyPasswordToClipboard}
                  disabled={!newPassword}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-xs text-slate-400 hover:text-purple-600 disabled:opacity-30"
                  title="Copy password"
                >
                  <Copy size={16} />
                </button>
              </div>

              <button
                type="button"
                onClick={generateRandomPassword}
                className="w-full py-1.5 px-3 bg-purple-50 dark:bg-purple-950/40 hover:bg-purple-100 text-purple-700 dark:text-purple-300 border border-purple-200/50 dark:border-purple-800/40 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-all"
              >
                <Sparkles size={14} /> Generate Random Strong Password
              </button>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={resetUserPassword}
                className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-semibold py-2.5 text-xs rounded-xl shadow-md shadow-purple-500/20 active:scale-95 transition-all"
              >
                Save New Password
              </button>
              <button
                onClick={() => {
                  setResetPasswordUser(null);
                  setNewPassword("");
                }}
                className="flex-1 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold py-2.5 text-xs rounded-xl hover:bg-slate-300 dark:hover:bg-slate-700 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
