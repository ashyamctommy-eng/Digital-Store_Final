"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { useStore } from "@/lib/browserStore";

const COINS_KEY = "dhs.coins";
const VIBE_KEY = "dhs.lastVibe";
/** Module-level defaults keep the store snapshots referentially stable. */
const NO_COINS = 0;
const NO_VIBE = "";

export default function AccountSettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const darkMode = theme === "dark";
  const [coins, setCoins] = useStore<number>(COINS_KEY, NO_COINS);
  const [lastVibe, setLastVibe] = useStore<string>(VIBE_KEY, NO_VIBE);
  const [vibeAnimation, setVibeAnimation] = useState(false);
  const [earnedToday, setEarnedToday] = useState(0);

  const today = new Date().toDateString();
  const canVibe = lastVibe !== today;

  const handleVibeCheck = () => {
    if (!canVibe) return;
    setVibeAnimation(true);
    const earned = Math.floor(Math.random() * 15) + 5; // 5-20 coins
    setCoins(coins + earned);
    setEarnedToday(earned);
    setLastVibe(today);
    setTimeout(() => setVibeAnimation(false), 2000);
  };

  const rewards = [
    { name: "5% Off Next Order", cost: 50, icon: "🏷️" },
    { name: "Free SMS Verification", cost: 30, icon: "📲" },
    { name: "10% Off Any Account", cost: 100, icon: "🔐" },
    { name: "Free Proxy Trial (1GB)", cost: 200, icon: "🌐" },
    { name: "VIP Early Stock Access", cost: 150, icon: "⭐" },
    { name: "Free VPN — 1 Month", cost: 300, icon: "🛡️" },
  ];

  const redeemReward = (cost: number, name: string) => {
    if (coins < cost) return;
    setCoins(coins - cost);
    alert(`🎉 Redeemed: ${name}\n\nYour discount code will be applied at checkout.`);
  };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center bg-[var(--color-cream)]"><p className="text-sm text-gray-400">Loading...</p></div>;

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--color-cream)] px-4">
        <h1 className="text-2xl font-bold mb-2">Sign In Required</h1>
        <p className="text-sm text-gray-500 mb-4">Please sign in to access account settings.</p>
        <Link href="/auth/signin/" className="bg-[var(--color-charcoal)] text-white px-6 py-3 text-xs font-bold uppercase tracking-wider">Sign In</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-cream)] dark:bg-gray-900 transition-colors duration-300">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold uppercase text-[var(--color-charcoal)] dark:text-white">DIGITAL<span className="text-[var(--color-accent)]">HUB SHOP</span></Link>
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Settings</h2>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Profile Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-5">
          <div className="flex items-center gap-4">
            {user.photoURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.photoURL} alt="" className="w-14 h-14 rounded-full border-2 border-[var(--color-gold)]" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-[var(--color-charcoal)] text-white flex items-center justify-center text-xl font-bold">{user.displayName?.charAt(0) || "U"}</div>
            )}
            <div>
              <h1 className="font-bold text-lg text-[var(--color-charcoal)] dark:text-white">{user.displayName || "User"}</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">{user.email}</p>
            </div>
          </div>
        </div>

        {/* Theme Toggle */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-4">Appearance</h2>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${darkMode ? "bg-gray-700" : "bg-amber-50"}`}>
                {darkMode ? (
                  <svg className="w-5 h-5 text-yellow-300" fill="currentColor" viewBox="0 0 24 24"><path d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" /></svg>
                ) : (
                  <svg className="w-5 h-5 text-amber-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0z" /><path d="M18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591z" /></svg>
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--color-charcoal)] dark:text-white">{darkMode ? "Dark Mode" : "Light Mode"}</p>
                <p className="text-[10px] text-gray-400">{darkMode ? "Easy on the eyes" : "Classic bright look"}</p>
              </div>
            </div>
            {/* Toggle Switch */}
            <button onClick={toggleTheme} className={`relative w-14 h-7 rounded-full transition-colors duration-300 ${darkMode ? "bg-[var(--color-gold)]" : "bg-gray-300"}`}>
              <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-300 ${darkMode ? "translate-x-7" : "translate-x-0"}`} />
            </button>
          </div>
        </div>

        {/* Daily Vibe Check */}
        <div className="bg-gradient-to-br from-[var(--color-charcoal)] to-gray-800 rounded-lg p-5 text-white">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-gold)]">Daily Vibe Check</h2>
              <p className="text-[10px] text-gray-400 mt-0.5">Check in daily to earn HubCoins</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-[var(--color-gold)]">{coins}</p>
              <p className="text-[9px] uppercase tracking-wider text-gray-400">HubCoins</p>
            </div>
          </div>

          {canVibe ? (
            <button
              onClick={handleVibeCheck}
              className="w-full bg-gradient-to-r from-[var(--color-gold)] to-amber-500 text-[var(--color-charcoal)] font-bold py-4 text-sm uppercase tracking-wider rounded hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <span className="text-lg">✨</span> Vibe Check Now <span className="text-lg">✨</span>
            </button>
          ) : (
            <div className={`w-full py-4 text-center rounded ${vibeAnimation ? "bg-green-500/20 border border-green-400/30" : "bg-white/5 border border-white/10"}`}>
              {vibeAnimation ? (
                <p className="text-green-400 font-bold text-sm">+{earnedToday} HubCoins Earned! 🎉</p>
              ) : (
                <p className="text-gray-400 text-xs">Vibe checked today! Come back tomorrow 💫</p>
              )}
            </div>
          )}

          <div className="mt-4 flex items-center gap-4">
            <div className="flex-1 bg-white/5 rounded-full h-2 overflow-hidden">
              <div className="bg-[var(--color-gold)] h-full rounded-full transition-all duration-500" style={{ width: `${Math.min((coins / 300) * 100, 100)}%` }} />
            </div>
            <p className="text-[9px] text-gray-400 whitespace-nowrap">{coins}/300 to top reward</p>
          </div>
        </div>

        {/* Rewards Store */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Rewards Store</h2>
              <p className="text-[10px] text-gray-400 mt-0.5">Swap your HubCoins for discounts</p>
            </div>
            <span className="text-xs font-bold text-[var(--color-gold)]">{coins} coins</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {rewards.map((reward) => (
              <div key={reward.name} className={`border dark:border-gray-700 rounded-lg p-3 flex items-center gap-3 transition-all ${coins >= reward.cost ? "hover:border-[var(--color-gold)] cursor-pointer" : "opacity-50"}`}>
                <span className="text-2xl">{reward.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[var(--color-charcoal)] dark:text-white truncate">{reward.name}</p>
                  <p className="text-[10px] text-[var(--color-gold)] font-bold">{reward.cost} coins</p>
                </div>
                <button
                  onClick={() => redeemReward(reward.cost, reward.name)}
                  disabled={coins < reward.cost}
                  className={`px-2 py-1 text-[9px] font-bold uppercase rounded transition-colors ${coins >= reward.cost ? "bg-[var(--color-gold)] text-white hover:bg-amber-600" : "bg-gray-100 dark:bg-gray-700 text-gray-400"}`}
                >
                  {coins >= reward.cost ? "Redeem" : "Locked"}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Links */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">Quick Links</h2>
          <div className="space-y-2">
            <Link href="/account/orders/" className="flex items-center justify-between py-2 border-b dark:border-gray-700 hover:text-[var(--color-accent)] transition-colors">
              <span className="text-sm text-[var(--color-charcoal)] dark:text-white">My Orders</span>
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </Link>
            <Link href="/" className="flex items-center justify-between py-2 hover:text-[var(--color-accent)] transition-colors">
              <span className="text-sm text-[var(--color-charcoal)] dark:text-white">Back to Store</span>
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
