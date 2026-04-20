/**
 * Global toast provider. Surfaces transient messages from anywhere in the app
 * via `useToast().show(message)`. Backed by ActivityToast for the visuals.
 */
import React, { createContext, useCallback, useContext, useState } from 'react';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ActivityToast, type Toast, type ToastAction } from '@/components/table-night/ActivityToast';

interface ToastContextValue {
    show: (message: string, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_TTL_MS = 3000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const [toasts, setToasts] = useState<Toast[]>([]);

    const dismiss = useCallback((id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const show = useCallback((message: string, action?: ToastAction) => {
        const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setToasts((prev) => [...prev, { id, message, timestamp: Date.now(), action }]);
        setTimeout(() => dismiss(id), TOAST_TTL_MS);
    }, [dismiss]);

    return (
        <ToastContext.Provider value={{ show }}>
            {children}
            <ActivityToast toasts={toasts} onDismiss={dismiss} palette={palette} />
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
