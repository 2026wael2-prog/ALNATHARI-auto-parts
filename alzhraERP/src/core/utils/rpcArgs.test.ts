import { describe, it, expect } from 'vitest';
import { optArg } from './rpcArgs';

describe('optArg', () => {
  it('omits null and undefined so the server applies its DEFAULT', () => {
    expect(optArg('p_from_date', null)).toEqual({});
    expect(optArg('p_from_date', undefined)).toEqual({});
  });

  it('omits empty and whitespace-only strings — the live 400 regression', () => {
    // An untouched <input type="date"> yields '', which PostgreSQL rejects with
    // 22007 "invalid input syntax for type date" => PostgREST 400.
    expect(optArg('p_from_date', '')).toEqual({});
    expect(optArg('p_to_date', '')).toEqual({});
    expect(optArg('p_branch_id', '')).toEqual({});
    expect(optArg('p_resolved', '')).toEqual({});
    expect(optArg('p_query', '   ')).toEqual({});
    expect(optArg('p_query', '\t\n')).toEqual({});
  });

  it('passes real values through unchanged', () => {
    expect(optArg('p_from_date', '2026-01-01')).toEqual({ p_from_date: '2026-01-01' });
    expect(optArg('p_currency_code', 'YER')).toEqual({ p_currency_code: 'YER' });
    expect(optArg('p_branch_id', 'abc-123')).toEqual({ p_branch_id: 'abc-123' });
  });

  it('preserves false and 0 rather than treating them as absent', () => {
    // Guards against a truthiness-based implementation, which would silently
    // turn `is_core: false` into "no filter" and flip the user's intent.
    expect(optArg('p_is_core', false)).toEqual({ p_is_core: false });
    expect(optArg('p_resolved', false)).toEqual({ p_resolved: false });
    expect(optArg('p_limit', 0)).toEqual({ p_limit: 0 });
    expect(optArg('p_search', '0')).toEqual({ p_search: '0' });
  });

  it('spreads into an rpc arg object without clobbering required params', () => {
    const args = {
      p_company_id: 'co-1',
      p_party_id: 'pa-1',
      ...optArg('p_from_date', ''),
      ...optArg('p_to_date', '2026-12-31'),
      ...optArg('p_currency_code', ''),
    };
    expect(args).toEqual({
      p_company_id: 'co-1',
      p_party_id: 'pa-1',
      p_to_date: '2026-12-31',
    });
    expect('p_from_date' in args).toBe(false);
    expect('p_currency_code' in args).toBe(false);
  });
});
