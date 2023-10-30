import { HttpError } from '@teable-group/core';
import axiosInstance from 'axios';

export const axios = axiosInstance.create({
  baseURL: '/api',
});

axios.interceptors.response.use(
  (response) => {
    // Any status code that lie within the range of 2xx cause this function to trigger
    return response;
  },
  (error) => {
    // Any status codes that falls outside the range of 2xx cause this function to trigger
    const { data, status } = error?.response || {};
    throw new HttpError(data || error?.message || 'no response from server', status || 500);
  }
);
