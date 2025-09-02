import { TestBed } from '@angular/core/testing';

import { Cards } from './cards';

describe('Cards', () => {
  let service: Cards;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Cards);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
