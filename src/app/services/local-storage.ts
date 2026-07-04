import { Injectable } from '@angular/core';

/**
 * Servizio per le operazioni con il localStorage.
 * Isola l'accesso al browser storage, gestisce eccezioni (SSR, quota exceeded)
 * e fornisce deserializzazione tipizzata.
 */
@Injectable({
	providedIn: 'root',
})
export class LocalStorage {
	/**
	 * Salva un valore serializzato in JSON.
	 * Non fa nulla in caso di errore (quota exceeded, SSR, ecc.).
	 */
	set<T>(key: string, value: T): void {
		try {
			localStorage.setItem(key, JSON.stringify(value));
		} catch {
			/* ignorato */
		}
	}

	/**
	 * Legge e deserializza un valore.
	 * Restituisce `null` se la chiave non esiste o il JSON è malformato.
	 */
	get<T>(key: string): T | null {
		try {
			const json = localStorage.getItem(key);
			return json ? (JSON.parse(json) as T) : null;
		} catch {
			return null;
		}
	}

	/** Rimuove una chiave dal localStorage. */
	remove(key: string): void {
		try {
			localStorage.removeItem(key);
		} catch {
			/* ignorato */
		}
	}
}
