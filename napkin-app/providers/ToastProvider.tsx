/**
 * Global toast provider. Surfaces transient messages from anywhere in the app
 * via `useToast().show(message)`. Backed by ActivityToast for the visuals.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { ActivityToast, type Toast, type ToastAction, type ToastOptions } from '@/components/table-night/ActivityToast';

interface ToastContextValue {
    show: (message: string, action?: ToastAction, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { session } = useAuth();
    const ownerId = session?.user.id;
    const [toasts, setToasts] = useState<(Toast & { ownerId?: string })[]>([]);
    useEffect(() => setToasts([]), [ownerId]);

    const dismiss = useCallback((id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const show = useCallback((message: string, action?: ToastAction, options?: ToastOptions) => {
        const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setToasts((prev) => [...prev.slice(0, 2), { id, message, timestamp: Date.now(), action, ownerId, ...options }]);
    }, [ownerId]);
    const value = useMemo(() => ({ show }), [show]);

    return (
        <ToastContext.Provider value={value}>
            {children}
            <ActivityToast toasts={toasts.filter((toast) => toast.ownerId === ownerId)} onDismiss={dismiss} palette={palette} />
        </ToastContext.Provider>
    );
}

export function useToast(): ToastContextValue {
    const ctx = useContext(ToastContext);
    if (!ctx) {
        // Fail-open: if we're rendered outside the provider (e.g. tests), no-op.
        return { show: (_m: string, _a?: ToastAction) => {} };
    }
    return ctx;
}
