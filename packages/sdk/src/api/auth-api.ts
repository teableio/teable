import type { AuthSchema } from '@teable-group/openapi';
import { AuthPath } from '@teable-group/openapi';
import { axios } from '../config/axios';

// eslint-disable-next-line @typescript-eslint/naming-convention
const { SING_IN, SING_OUT, SING_UP, USER_ME } = AuthPath;

export const signin = async (body: AuthSchema.Signin) => {
  return axios.post<AuthSchema.SigninVo>(SING_IN, body);
};

export const signup = async (body: AuthSchema.Signup) => {
  return axios.post<AuthSchema.SignupVo>(SING_UP, body);
};

export const signout = async () => {
  return axios.post<null>(SING_OUT);
};

export const userMe = async () => {
  return axios.get<AuthSchema.UserMeVo>(USER_ME);
};
