import { Component, provideZonelessChangeDetection, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Tweener } from './tweener';

@Component({
	imports: [Tweener],
	template: `
		<div
			uiTweenScope
			[duration]="40"
			[stagger]="0"
			style="position: relative; width: 400px; height: 200px"
		>
			<div style="position: absolute; left: 0; top: 0">
				@for (id of a(); track id) {
					<div [attr.tween-id]="id" style="width: 20px; height: 20px"></div>
				}
			</div>
			<div style="position: absolute; left: 200px; top: 100px">
				@for (id of b(); track id) {
					<div [attr.tween-id]="id" style="width: 20px; height: 20px"></div>
				}
			</div>
		</div>
	`,
})
class HostCmp {
	a = signal<number[]>([1, 2, 3]);
	b = signal<number[]>([]);
	tw = viewChild.required(Tweener);
}

/** Attende che il MutationObserver (microtask) abbia processato il batch. */
function flushMutations(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve));
}

function byId(fixture: ComponentFixture<HostCmp>, id: number): HTMLElement[] {
	return Array.from(
		(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(`[tween-id="${id}"]`),
	);
}

describe('Tweener', () => {
	let fixture: ComponentFixture<HostCmp>;
	let host: HostCmp;

	beforeEach(async () => {
		await TestBed.configureTestingModule({
			imports: [HostCmp],
			providers: [provideZonelessChangeDetection()],
		}).compileComponents();

		fixture = TestBed.createComponent(HostCmp);
		host = fixture.componentInstance;
		fixture.detectChanges();
	});

	it('should create', () => {
		expect(host.tw()).toBeTruthy();
	});

	it('anima lo spostamento cross-parent (pairing rimozione → aggiunta)', async () => {
		host.a.set([1, 2]);
		host.b.set([3]);
		fixture.detectChanges();
		await flushMutations();

		const tw = host.tw();
		expect(tw.pendings()).toBe(1);
		const [moved] = byId(fixture, 3);
		expect(moved.classList.contains('tweening')).toBeTrue();

		await tw.whenIdle();
		expect(tw.pendings()).toBe(0);
		expect(moved.classList.contains('tweening')).toBeFalse();
		// pos ritimbrata sulla destinazione (viewport del contenitore B)
		const r = moved.getBoundingClientRect();
		expect(moved.getAttribute('pos')).toBe(`${Math.round(r.x)},${Math.round(r.y)}`);
	});

	it('consuma il gemello quando lo stesso id è in entrambi i parent', async () => {
		// Duplicazione transitoria: l'id 3 appare in B mentre è ancora in A
		// (equivale a una rimozione differita da animate.leave).
		host.b.set([3]);
		fixture.detectChanges();
		await flushMutations();

		const tw = host.tw();
		const copies = byId(fixture, 3);
		expect(copies.length).toBe(2);

		const consumed = copies.filter((el) => el.hasAttribute('tween-consumed'));
		expect(consumed.length).toBe(1); // il gemello preesistente in A
		expect(consumed[0].style.visibility).toBe('hidden'); // mai due istanze visibili
		const target = copies.find((el) => !el.hasAttribute('tween-consumed'))!;
		expect(target.classList.contains('tweening')).toBeTrue();
		expect(tw.pendings()).toBe(1);

		// La rimozione tardiva del gemello NON deve ri-primare un secondo tween.
		host.a.set([1, 2]);
		fixture.detectChanges();
		await flushMutations();
		await tw.whenIdle();

		expect(tw.pendings()).toBe(0);
		expect(byId(fixture, 3).length).toBe(1);
		expect(byId(fixture, 3)[0].hasAttribute('tween-data-prev')).toBeFalse();
	});

	it('reset annulla i tween in volo e azzera pendings', async () => {
		host.a.set([2, 3, 1]); // riordino: FLIP sugli elementi spostati
		fixture.detectChanges();
		await flushMutations();

		const tw = host.tw();
		expect(tw.pendings()).toBeGreaterThan(0);

		tw.reset();
		expect(tw.pendings()).toBe(0);
		const tweening = (fixture.nativeElement as HTMLElement).querySelectorAll('.tweening');
		expect(tweening.length).toBe(0);
	});

	it('whenIdle risolve subito se non ci sono tween', async () => {
		await expectAsync(host.tw().whenIdle()).toBeResolved();
	});

	it('riordino durante un volo: nessuna carta persa, sovrapposta o bloccata', async () => {
		// Avvia un volo cross-parent…
		host.a.set([1, 2]);
		host.b.set([3]);
		fixture.detectChanges();
		await flushMutations();
		const tw = host.tw();
		expect(tw.pendings()).toBe(1);

		// …e riordina A mentre il volo di 3 è ancora in corso.
		host.a.set([2, 1]);
		fixture.detectChanges();
		await flushMutations();

		await tw.whenIdle();
		expect(tw.pendings()).toBe(0);

		const els = Array.from(
			(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[tween-id]'),
		);
		expect(els.length).toBe(3);
		const positions = new Set<string>();
		for (const el of els) {
			expect(el.classList.contains('tweening')).toBeFalse();
			expect(getComputedStyle(el).visibility).toBe('visible');
			const r = el.getBoundingClientRect();
			positions.add(`${Math.round(r.x)},${Math.round(r.y)}`);
		}
		// Tutte le carte visibili e in slot distinti: nessuna "sparita".
		expect(positions.size).toBe(3);
	});

	it('hold() sospende i tween (drag&drop), release() li riattiva', async () => {
		const tw = host.tw();
		tw.hold();

		// Mutazione sotto hold: nessun volo, applicazione istantanea.
		host.a.set([1, 2]);
		host.b.set([3]);
		fixture.detectChanges();
		await flushMutations();
		expect(tw.pendings()).toBe(0);

		tw.release();
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

		// Dopo il release le posizioni sono ritarate: un nuovo spostamento anima.
		host.a.set([1, 2, 3]);
		host.b.set([]);
		fixture.detectChanges();
		await flushMutations();
		expect(tw.pendings()).toBe(1);
		await tw.whenIdle();
		expect(tw.pendings()).toBe(0);
	});
});
