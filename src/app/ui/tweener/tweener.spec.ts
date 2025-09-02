import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Tweener } from './tweener';

describe('Tweener', () => {
  let component: Tweener;
  let fixture: ComponentFixture<Tweener>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Tweener]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Tweener);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
