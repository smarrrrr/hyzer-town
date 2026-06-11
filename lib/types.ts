export interface PlayerScore {
  name: string;
  total: number;
  relativeToPar: number | null;
  roundRating: number | null;
  holes: (number | null)[];
}

export interface Round {
  id: string; // courseName + startDate, slugified
  courseName: string;
  layoutName: string;
  startDate: string;
  endDate: string;
  pars: (number | null)[];
  holeCount: number;
  players: PlayerScore[];
  importedBy: string[]; // user IDs
  createdAt: number;
  updatedAt: number;
}

export interface UserProfile {
  udiscNames: string[];
}
