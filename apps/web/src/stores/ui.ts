// Cross-page UI state: the polite live-region announcement. Status changes are
// announced once through a single region instead of many competing ones (W11-17).
import { create } from 'zustand';

export interface UiState {
  announcement: string;
  announce(text: string): void;
}

export const useUi = create<UiState>()((set) => ({
  announcement: '',
  announce: (text) => set({ announcement: text }),
}));

export const selectAnnouncement = (state: UiState) => state.announcement;
export const selectAnnounce = (state: UiState) => state.announce;
