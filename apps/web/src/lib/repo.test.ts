import { describe, expect, it } from 'vitest';
import { parseRepoInput } from './repo';

describe('parseRepoInput', () => {
  it.each([
    ['https://github.com/near-examples/guest-book-examples', { repo: 'near-examples/guest-book-examples' }],
    ['github.com/near/near-sdk-rs/', { repo: 'near/near-sdk-rs' }],
    ['near/near-sdk-rs.git', { repo: 'near/near-sdk-rs' }],
    ['near/near-sdk-rs@v5.0.0', { repo: 'near/near-sdk-rs', ref: 'v5.0.0' }],
  ])('accepts %s', (input, expected) => {
    expect(parseRepoInput(input)).toEqual(expected);
  });

  it.each(['foo bar', '', 'just-one-part', 'https://gitlab.com/o/r', 'o/r/extra', 'o/r@'])('rejects %j', (input) => {
    expect(parseRepoInput(input)).toBeNull();
  });
});
