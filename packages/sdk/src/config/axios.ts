import { toast } from '@teable-group/ui-lib';
import axiosInstance from 'axios';

export const axios = axiosInstance.create();

axios.interceptors.response.use(
  (response) => {
    // Any status code that lie within the range of 2xx cause this function to trigger
    return response;
  },
  (error) => {
    // Any status codes that falls outside the range of 2xx cause this function to trigger
    if (error.response) {
      toast({
        variant: 'destructive',
        title: error.response.data?.title || 'Unknown Error',
        description: error.response.data?.errors,
      });
      throw error;
    }

    toast({
      variant: 'destructive',
      title: 'Network error',
      description: 'no response from server',
    });
    // If no response, throw the error (network error etc.)
    throw error;
  }
);
