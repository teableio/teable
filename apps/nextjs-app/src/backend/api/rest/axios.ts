import { HttpError } from '@teable-group/core';
import axiosInstance from 'axios';

export const axios = axiosInstance.create({
  baseURL: `http://localhost:${process.env.PORT}/api`,
});

axios.interceptors.response.use(
  (response) => {
    // Any status code that lie within the range of 2xx cause this function to trigger
    return response;
  },
  (error) => {
    const { data, status } = error?.response || {};
    throw new HttpError(data || 'no response from server', status || 500);
  }
);
