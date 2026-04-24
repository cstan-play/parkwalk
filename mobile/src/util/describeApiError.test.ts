import axios from 'axios';

import { describeApiError } from './describeApiError';

describe('describeApiError', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns server message when present', () => {
    const err = {
      isAxiosError: true,
      response: { data: { error: { message: 'Email taken' } } },
    };
    jest.spyOn(axios, 'isAxiosError').mockReturnValueOnce(true);
    expect(describeApiError(err)).toBe('Email taken');
  });

  it('explains missing response with base URL hint', () => {
    const err = {
      isAxiosError: true,
      message: 'Network Error',
      response: undefined,
      config: { baseURL: 'https://parkwalk-production.up.railway.app', url: '/api/v1/auth/register' },
    };
    jest.spyOn(axios, 'isAxiosError').mockReturnValueOnce(true);
    const msg = describeApiError(err);
    expect(msg).toContain('https://parkwalk-production.up.railway.app');
    expect(msg).toContain('HTTPS');
  });
});
