import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RecommendationFeedback } from '../lib/recommendations';
interface FeedbackState extends RecommendationFeedback {
  toggleHidden: (id: string) => void;
  recordSkip: (id: string) => void;
}
// This feedback stays on this browser. Listening history is never sent to an AI.
export const useRecommendationStore = create<FeedbackState>()(persist((set) => ({
  hidden: [], skips: {},
  toggleHidden: (id) => set((state) => ({ hidden: state.hidden.includes(id) ? state.hidden.filter((value) => value !== id) : [...state.hidden, id].slice(-500) })),
  recordSkip: (id) => set((state) => ({ skips: Object.fromEntries([...Object.entries(state.skips).filter(([key]) => key !== id), [id, Math.min(4, (state.skips[id] ?? 0) + 1)]].slice(-500)) })),
}), { name: 'aurora-recommendation-feedback', partialize: ({ hidden, skips }) => ({ hidden, skips }) }));
