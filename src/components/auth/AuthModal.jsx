import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Mail, Lock, Loader2, AlertCircle, CheckCircle2, Cloud } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '../../lib/supabaseClient';

function GoogleLogo() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export default function AuthModal({ isOpen, onClose, t }) {
  const [authTab, setAuthTab] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loadingOAuth, setLoadingOAuth] = useState(false);
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg('');
    setInfoMsg('');
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  const handleGoogleSignIn = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setErrorMsg(t.supabaseNotConfigured);
      return;
    }
    setErrorMsg('');
    setInfoMsg('');
    setLoadingOAuth(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) {
        setErrorMsg(error.message);
        setLoadingOAuth(false);
      }
    } catch (err) {
      setErrorMsg(err?.message || t.authGenericError);
      setLoadingOAuth(false);
    }
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    if (!isSupabaseConfigured || !supabase) {
      setErrorMsg(t.supabaseNotConfigured);
      return;
    }
    setErrorMsg('');
    setInfoMsg('');
    setLoadingEmail(true);

    try {
      if (authTab === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          setErrorMsg(error.message);
        } else {
          onClose();
        }
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) {
          setErrorMsg(error.message);
        } else if (data?.session) {
          onClose();
        } else {
          setInfoMsg(t.authCheckEmailNotice);
        }
      }
    } catch (err) {
      setErrorMsg(err?.message || t.authGenericError);
    } finally {
      setLoadingEmail(false);
    }
  };

  const busy = loadingOAuth || loadingEmail;

  return createPortal(
    <div
      className="hd-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4 no-print"
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.authModalTitle}
        onClick={(e) => e.stopPropagation()}
        className="hd-modal-in w-full max-w-md rounded-xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E8E8E5] dark:border-[#2F2F2F] shadow-2xl p-6 space-y-4"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-indigo-500/12 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-semibold text-[16px] text-[#262624] dark:text-[#ECECEA]">
                {t.authModalTitle}
              </h2>
              <p className="text-[13px] text-[#6B6A66] dark:text-[#9B9A97] mt-0.5">
                {t.authModalSubtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label={t.closeDrawer}
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-[#6B6A66] dark:text-[#9B9A97] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] transition-colors duration-150 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Unconfigured Supabase Fallback Notice */}
        {!isSupabaseConfigured && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-2.5 text-[13px] text-amber-800 dark:text-amber-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-snug">{t.supabaseNotConfigured}</span>
          </div>
        )}

        {/* Primary Google OAuth Button */}
        <button
          type="button"
          disabled={busy || !isSupabaseConfigured}
          onClick={handleGoogleSignIn}
          className="w-full min-h-[44px] px-4 rounded-lg border border-[#E8E8E5] dark:border-[#3A3A3A] bg-[#FFFFFF] dark:bg-[#202020] hover:bg-[#F3F3F1] dark:hover:bg-[#2E2E2E] disabled:opacity-50 text-[#262624] dark:text-[#ECECEA] text-[14px] font-semibold inline-flex items-center justify-center gap-2.5 transition-colors duration-150 cursor-pointer"
        >
          {loadingOAuth ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <GoogleLogo />
          )}
          <span>{t.continueWithGoogle}</span>
        </button>

        {/* Clean Hairline Divider ("or") */}
        <div className="relative flex items-center">
          <div className="flex-1 border-t border-[#E8E8E5] dark:border-[#2F2F2F]" />
          <span className="px-3 text-[12px] font-medium uppercase tracking-wider text-[#6B6A66] dark:text-[#9B9A97]">
            {t.authOrDivider}
          </span>
          <div className="flex-1 border-t border-[#E8E8E5] dark:border-[#2F2F2F]" />
        </div>

        {/* Sign In / Create Account Mode Switcher */}
        <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#F3F3F1] dark:bg-[#191919]">
          <button
            type="button"
            onClick={() => {
              setAuthTab('signin');
              setErrorMsg('');
              setInfoMsg('');
            }}
            className={`min-h-[36px] rounded-lg text-[13px] font-semibold transition-colors duration-150 cursor-pointer ${
              authTab === 'signin'
                ? 'bg-[#FFFFFF] dark:bg-[#262626] text-[#262624] dark:text-[#ECECEA] shadow-2xs'
                : 'text-[#6B6A66] dark:text-[#9B9A97] hover:text-[#262624] dark:hover:text-[#ECECEA]'
            }`}
          >
            {t.signInTab}
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthTab('signup');
              setErrorMsg('');
              setInfoMsg('');
            }}
            className={`min-h-[36px] rounded-lg text-[13px] font-semibold transition-colors duration-150 cursor-pointer ${
              authTab === 'signup'
                ? 'bg-[#FFFFFF] dark:bg-[#262626] text-[#262624] dark:text-[#ECECEA] shadow-2xs'
                : 'text-[#6B6A66] dark:text-[#9B9A97] hover:text-[#262624] dark:hover:text-[#ECECEA]'
            }`}
          >
            {t.createAccountTab}
          </button>
        </div>

        {/* Feedback Banners */}
        {errorMsg && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 flex items-start gap-2 text-[13px] text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-snug">{errorMsg}</span>
          </div>
        )}

        {infoMsg && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-start gap-2 text-[13px] text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-snug">{infoMsg}</span>
          </div>
        )}

        {/* Email + Password Form */}
        <form onSubmit={handleEmailSubmit} className="space-y-3.5">
          <div>
            <label htmlFor="hd-auth-email" className="block text-[13px] font-medium text-[#6B6A66] dark:text-[#9B9A97] mb-1">
              {t.emailLabel}
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#6B6A66] dark:text-[#9B9A97] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="hd-auth-email"
                type="email"
                required
                autoComplete="email"
                disabled={busy || !isSupabaseConfigured}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.emailPlaceholder}
                className="w-full min-h-[42px] pl-9 pr-3 rounded-lg border border-[#E8E8E5] dark:border-[#3A3A3A] bg-[#FBFBFA] dark:bg-[#191919] text-[14px] text-[#262624] dark:text-[#ECECEA] focus:bg-[#FFFFFF] dark:focus:bg-[#191919] focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label htmlFor="hd-auth-password" className="block text-[13px] font-medium text-[#6B6A66] dark:text-[#9B9A97] mb-1">
              {t.passwordLabel}
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#6B6A66] dark:text-[#9B9A97] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="hd-auth-password"
                type="password"
                required
                minLength={6}
                autoComplete={authTab === 'signin' ? 'current-password' : 'new-password'}
                disabled={busy || !isSupabaseConfigured}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t.passwordPlaceholder}
                className="w-full min-h-[42px] pl-9 pr-3 rounded-lg border border-[#E8E8E5] dark:border-[#3A3A3A] bg-[#FBFBFA] dark:bg-[#191919] text-[14px] text-[#262624] dark:text-[#ECECEA] focus:bg-[#FFFFFF] dark:focus:bg-[#191919] focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy || !isSupabaseConfigured}
            className="w-full min-h-[44px] rounded-lg bg-[#262624] hover:bg-[#191919] dark:bg-[#ECECEA] dark:hover:bg-white disabled:opacity-50 text-white dark:text-[#191919] text-[14px] font-semibold inline-flex items-center justify-center gap-2 transition-colors duration-150 cursor-pointer"
          >
            {loadingEmail && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{authTab === 'signin' ? t.signInAction : t.createAccountAction}</span>
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
}
