import { createContext, useContext } from 'react'

/** Woran das Info-Fenster einen Titel erkennt: am Schlüssel in Plex oder an Art und TMDB-Nummer. */
export interface TitleRef {
  /** Schlüssel des Titels in Plex; darf auch der einer einzelnen Folge sein */
  rating_key?: number | null
  type?: string
  tmdb_id?: number | null
  title: string
  year?: number | null
  thumb?: string | null
  /** Poster-Pfad bei TMDB, falls der Titel nicht auf dem Server liegt */
  poster?: string | null
}

export const TitleInfoContext = createContext<(ref: TitleRef) => void>(() => {})

/** Öffnet das Info-Fenster zu einem Titel, egal aus welcher Ansicht. */
export const useTitleInfo = () => useContext(TitleInfoContext)

/** Meldet allen Ansichten, dass sich an den Daten etwas geändert hat, etwa nach dem Löschen. */
export const CHANGED = 'blackbriar-changed'
