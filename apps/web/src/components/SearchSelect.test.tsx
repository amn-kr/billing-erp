// @vitest-environment jsdom
/** The shared searchable drop-down: filter, keyboard, no match, the "+ Add" row, and Esc closing only the list. */
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchSelect, type SsOption } from './SearchSelect';

const OPTS: SsOption[] = [{ value: 'Anchor' }, { value: 'Havells' }, { value: 'Havells India' }, { value: 'Legrand', disabled: true, note: 'already added' }, { value: 'Polycab' }];

function Box({ onAdd, onWindowEsc, empty, start = '' }: { onAdd?: (t: string) => void; onWindowEsc?: () => void; empty?: string; start?: string }) {
  const [v, setV] = useState(start);
  return (
    <div onKeyDown={(e) => e.key === 'Escape' && onWindowEsc?.()}>
      <label>Brand<SearchSelect id="b" value={v} options={OPTS} onChange={setV} placeholder="Choose brand" empty={empty} add={onAdd && '+ Add new brand'} onAdd={onAdd} /></label>
      <output data-testid="v">{v}</output>
    </div>
  );
}
const field = () => screen.getByRole('combobox') as HTMLInputElement;
const names = () => screen.queryAllByRole('option').map((o) => o.textContent);
const active = () => document.getElementById(field().getAttribute('aria-activedescendant') ?? '')?.textContent;
const type = (t: string) => fireEvent.change(field(), { target: { value: t } });
const press = (key: string) => fireEvent.keyDown(field(), { key });

afterEach(cleanup);

describe('SearchSelect', () => {
  it('is a combobox with a listbox; a click opens the whole list, a click on a row picks it', () => {
    render(<Box />);
    expect(field().getAttribute('aria-expanded')).toBe('false');
    expect(field().placeholder).toBe('Choose brand');
    fireEvent.click(field());
    expect(field().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('listbox').id).toBe(field().getAttribute('aria-controls'));
    expect(names()).toEqual(['Anchor', 'Havells', 'Havells India', 'Legrandalready added', 'Polycab']);
    fireEvent.click(screen.getByRole('option', { name: 'Polycab' }));
    expect(screen.getByTestId('v').textContent).toBe('Polycab');
    expect(field().value).toBe('Polycab');
    expect(field().getAttribute('aria-expanded')).toBe('false');
  });

  it('typing filters by "contains", ignoring capital letters; Enter picks the first match', () => {
    render(<Box />);
    type('ELL');
    expect(names()).toEqual(['Havells', 'Havells India']);
    expect(active()).toBe('Havells');
    press('Enter');
    expect(screen.getByTestId('v').textContent).toBe('Havells');
  });

  it('arrow keys move over the rows (wrapping, skipping rows that cannot be picked); Enter picks', () => {
    render(<Box start="Havells India" />);
    press('ArrowDown');
    expect(field().getAttribute('aria-expanded')).toBe('true');
    expect(active()).toBe('Havells India');
    press('ArrowDown');
    expect(active()).toBe('Polycab');
    press('ArrowDown');
    expect(active()).toBe('Anchor');
    press('ArrowUp');
    press('ArrowUp');
    expect(active()).toBe('Havells India');
    press('ArrowUp');
    press('Enter');
    expect(screen.getByTestId('v').textContent).toBe('Havells');
  });

  it('a row that cannot be picked stays unpicked when clicked', () => {
    render(<Box />);
    fireEvent.click(field());
    const row = screen.getByRole('option', { name: /Legrand/ });
    expect(row.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(row);
    expect(screen.getByTestId('v').textContent).toBe('');
  });

  it('no match says so; the "+ Add" row gets what was typed, and Enter adds it', () => {
    const onAdd = vi.fn();
    render(<Box onAdd={onAdd} />);
    type('Wipro');
    expect(screen.getByText('No match')).toBeTruthy();
    expect(names()).toEqual(['+ Add new brand “Wipro”']);
    press('Enter');
    expect(onAdd).toHaveBeenCalledWith('Wipro');
    // the add row is also there at the end of the full list
    fireEvent.click(field());
    expect(names().at(-1)).toBe('+ Add new brand');
    fireEvent.click(screen.getByRole('option', { name: '+ Add new brand' }));
    expect(onAdd).toHaveBeenLastCalledWith('');
  });

  it('without an add row, no match is just the text', () => {
    render(<Box />);
    type('zz');
    expect(names()).toEqual([]);
    expect(screen.getByText('No match')).toBeTruthy();
  });

  it('Esc with the list open closes only the list; Esc again reaches the window', () => {
    const onWindowEsc = vi.fn();
    render(<Box onWindowEsc={onWindowEsc} start="Anchor" />);
    type('pol');
    press('Escape');
    expect(field().getAttribute('aria-expanded')).toBe('false');
    expect(field().value).toBe('Anchor');
    expect(onWindowEsc).not.toHaveBeenCalled();
    press('Escape');
    expect(onWindowEsc).toHaveBeenCalledTimes(1);
  });

  it('clear: the "none" row, or empty the text and leave; other typed text is dropped on leaving', () => {
    render(<Box empty="No brand" start="Anchor" />);
    fireEvent.click(field());
    expect(names()[0]).toBe('No brand');
    fireEvent.click(screen.getByRole('option', { name: 'No brand' }));
    expect(screen.getByTestId('v').textContent).toBe('');
    fireEvent.click(field());
    fireEvent.click(screen.getByRole('option', { name: 'Polycab' }));
    type('Hav');
    fireEvent.blur(field());
    expect(field().value).toBe('Polycab');
    type('');
    press('Tab');
    expect(screen.getByTestId('v').textContent).toBe('');
  });

  it('a locked field shows its hint and does not open', () => {
    render(<SearchSelect id="s" value="" options={OPTS} onChange={() => {}} placeholder="Choose a brand first" disabled />);
    expect(field().disabled).toBe(true);
    expect(field().placeholder).toBe('Choose a brand first');
  });
});
