import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DeckItem } from '../../services/cards';
import { Deck } from './deck';

describe('Deck', () => {
	let component: Deck;
	let fixture: ComponentFixture<Deck>;

	beforeEach(async () => {
		await TestBed.configureTestingModule({
			imports: [Deck],
			providers: [provideZonelessChangeDetection()],
		}).compileComponents();

		fixture = TestBed.createComponent(Deck);
		component = fixture.componentInstance;
		fixture.detectChanges();
	});

	it('should create', () => {
		expect(component).toBeTruthy();
	});

	function setCards(tags: string[]): DeckItem[] {
		const items = tags.map((t) => new DeckItem(t, false));
		fixture.componentRef.setInput('cards', items);
		fixture.detectChanges();
		return items;
	}

	it('non perde né duplica carte dopo autosortNow (riordino)', () => {
		setCards(['K♠️', '3♥️', 'A♦️', '7♣️', '10♥️']);
		expect(component.list().length).toBe(5);

		component.autosortNow();
		fixture.detectChanges();

		expect(component.list().length).toBe(5);
		const uids = new Set(component.list().map((c) => c.uid));
		expect(uids.size).toBe(5); // nessun uid perso o duplicato
	});

	it('autosortNow ordina per seme (cuori→quadri→fiori→picche) poi per rank', () => {
		setCards(['K♠️', '3♥️', 'A♦️', '7♣️', '10♥️']);
		component.autosortNow();
		fixture.detectChanges();

		expect(component.list().map((c) => c.tag)).toEqual(['3♥️', '10♥️', 'A♦️', '7♣️', 'K♠️']);
	});

	it('conserva il conteggio anche riordinando più volte di fila', () => {
		setCards(['5♣️', '2♥️', 'Q♦️', '9♠️', 'A♥️', 'J♣️']);
		component.autosortNow();
		fixture.detectChanges();
		component.autosortNow();
		fixture.detectChanges();

		expect(component.list().length).toBe(6);
	});
});
