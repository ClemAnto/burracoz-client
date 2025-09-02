import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Deck } from './deck';

describe('Deck', () => {
  let component: Deck;
  let fixture: ComponentFixture<Deck>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Deck]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Deck);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
