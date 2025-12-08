import { create } from 'zustand';

interface UIStore {
    // Review modal state
    isReviewModalOpen: boolean;
    openReviewModal: () => void;
    closeReviewModal: () => void;

    // Map filter state
    activeMapFilter: string | null;
    setMapFilter: (filter: string | null) => void;

    // Draft review text (persists while navigating)
    pendingReviewDraft: string;
    setPendingReviewDraft: (text: string) => void;
    clearPendingReviewDraft: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
    // Review modal
    isReviewModalOpen: false,
    openReviewModal: () => set({ isReviewModalOpen: true }),
    closeReviewModal: () => set({ isReviewModalOpen: false }),

    // Map filter
    activeMapFilter: null,
    setMapFilter: (filter) => set({ activeMapFilter: filter }),

    // Draft review
    pendingReviewDraft: '',
    setPendingReviewDraft: (text) => set({ pendingReviewDraft: text }),
    clearPendingReviewDraft: () => set({ pendingReviewDraft: '' }),
}));
