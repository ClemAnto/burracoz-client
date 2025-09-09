import { TestBed } from '@angular/core/testing';

import { Rules } from './rules';

describe('Rules', () => {
  let service: Rules;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Rules);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
