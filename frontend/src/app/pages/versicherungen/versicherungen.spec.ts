import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Versicherungen } from './versicherungen';

describe('Versicherungen', () => {
  let component: Versicherungen;
  let fixture: ComponentFixture<Versicherungen>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Versicherungen],
    }).compileComponents();

    fixture = TestBed.createComponent(Versicherungen);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
