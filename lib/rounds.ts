import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from './firestore';
import type { Round, UserProfile } from './types';

// User profile

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, 'users', userId));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

export async function saveUserProfile(userId: string, profile: Partial<UserProfile>) {
  await setDoc(doc(db, 'users', userId), profile, { merge: true });
}

// Rounds

export async function getRoundById(roundId: string): Promise<Round | null> {
  const snap = await getDoc(doc(db, 'rounds', roundId));
  return snap.exists() ? (snap.data() as Round) : null;
}

export async function getRoundsImportedBy(userId: string): Promise<Round[]> {
  const q = query(collection(db, 'rounds'), where('importedBy', 'array-contains', userId));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as Round);
}

export async function importRound(round: Round, userId: string): Promise<void> {
  const ref = doc(db, 'rounds', round.id);
  const existing = await getDoc(ref);

  if (existing.exists()) {
    // Merge players in case new ones were added, mark this user as importer
    const prev = existing.data() as Round;
    const mergedPlayers = [...prev.players];
    for (const player of round.players) {
      if (!mergedPlayers.find(p => p.name === player.name)) {
        mergedPlayers.push(player);
      }
    }
    await updateDoc(ref, {
      players: mergedPlayers,
      importedBy: arrayUnion(userId),
      updatedAt: Date.now(),
    });
  } else {
    await setDoc(ref, {
      ...round,
      importedBy: [userId],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
}
