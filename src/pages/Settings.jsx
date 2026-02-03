import React, { useState, useEffect } from 'react';
import { Moon, Sun, Settings as SettingsIcon, X, Lock, Eye, EyeOff } from 'lucide-react';
import api from '../services/api';
import { toast } from 'react-toastify';

export default function Settings({ onClose, onThemeChange }) {
  const [theme, setTheme] = useState('light');
  const [fileSharingEnabled, setFileSharingEnabled] = useState(true);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  useEffect(() => {
    // Load saved theme from localStorage
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);
    document.documentElement.classList.toggle('dark', savedTheme === 'dark');
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
    if (onThemeChange) onThemeChange(newTheme);
  };

  const toggleFileSharing = () => {
    const newState = !fileSharingEnabled;
    setFileSharingEnabled(newState);
    localStorage.setItem('fileSharingEnabled', newState);
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setIsChangingPassword(true);

    try {
      await api.post('/api/auth/change-password', {
        currentPassword,
        newPassword
      });

      toast.success('Password changed successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      const message = err.response?.data?.error || 'Failed to change password';
      toast.error(message);
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-800 dark:text-white">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Theme Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900">
                {theme === 'light' ? (
                  <Sun className="text-blue-600 dark:text-blue-300" size={18} />
                ) : (
                  <Moon className="text-blue-600 dark:text-blue-300" size={18} />
                )}
              </div>
              <span className="text-gray-700 dark:text-gray-200 font-medium">
                {theme === 'light' ? 'Light Mode' : 'Dark Mode'}
              </span>
            </div>
            <button
              onClick={toggleTheme}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Switch to {theme === 'light' ? 'Dark' : 'Light'} Mode
            </button>
          </div>

          {/* File Sharing Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-full bg-green-100 dark:bg-green-900">
                <SettingsIcon className="text-green-600 dark:text-green-300" size={18} />
              </div>
              <span className="text-gray-700 dark:text-gray-200 font-medium">
                File Sharing
              </span>
            </div>
            <button
              onClick={toggleFileSharing}
              className={`px-4 py-2 rounded-lg transition-colors ${fileSharingEnabled
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-gray-300 hover:bg-gray-400 text-gray-700 dark:bg-gray-600 dark:hover:bg-gray-500 dark:text-gray-200'
                }`}
            >
              {fileSharingEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>

          {/* Change Password Section */}
          <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2 rounded-full bg-purple-100 dark:bg-purple-900">
                <Lock className="text-purple-600 dark:text-purple-300" size={18} />
              </div>
              <span className="text-gray-700 dark:text-gray-200 font-medium">
                Change Password
              </span>
            </div>

            <form onSubmit={handleChangePassword} className="space-y-3">
              <div className="relative">
                <input
                  type={showCurrentPassword ? "text" : "password"}
                  placeholder="Current Password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-3 py-2 pr-10 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                >
                  {showCurrentPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              <div className="relative">
                <input
                  type={showNewPassword ? "text" : "password"}
                  placeholder="New Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 pr-10 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                >
                  {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              <input
                type="password"
                placeholder="Confirm New Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                required
              />

              <button
                type="submit"
                disabled={isChangingPassword}
                className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white py-2 rounded-lg transition-colors"
              >
                {isChangingPassword ? 'Changing...' : 'Change Password'}
              </button>
            </form>
          </div>
        </div>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Settings are saved automatically
          </p>
        </div>
      </div>
    </div>
  );
}
