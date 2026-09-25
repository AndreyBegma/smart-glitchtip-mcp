import { describe, expect, it } from 'vitest';
import { parseNextCursor } from './pagination';

const URL_ = 'https://g.test/api/0/organizations/';

describe('parseNextCursor', () => {
  it('returns the next cursor when results="true"', () => {
    const link =
      `<${URL_}?&cursor=0:0:1>; rel="previous"; results="false"; cursor="0:0:1", ` +
      `<${URL_}?&cursor=0:50:0>; rel="next"; results="true"; cursor="0:50:0"`;
    expect(parseNextCursor(link)).toBe('0:50:0');
  });

  it('returns undefined on the last page', () => {
    const link =
      `<${URL_}?cursor=a>; rel="previous"; results="true"; cursor="a", ` +
      `<${URL_}?cursor=b>; rel="next"; results="false"; cursor="b"`;
    expect(parseNextCursor(link)).toBeUndefined();
  });

  it('copes with commas inside the URL and a missing header', () => {
    expect(parseNextCursor(`<${URL_}?a=1,2>; rel="next"; results="true"; cursor="c"`)).toBe('c');
    expect(parseNextCursor(null)).toBeUndefined();
    expect(parseNextCursor('garbage')).toBeUndefined();
  });
});
