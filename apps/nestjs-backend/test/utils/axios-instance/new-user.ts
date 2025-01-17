import { axios, SIGN_UP, createAxios, USER_ME, SIGN_IN } from '@teable/openapi';
import { signupPasswordSchema } from '@teable/openapi/src/auth/types';

export async function createNewUserAxios({ email, password }: { email: string; password: string }) {
  if (!signupPasswordSchema.safeParse(password).success) {
    password = `${password}a`;
  }
  const signAxios = createAxios();
  signAxios.defaults.baseURL = axios.defaults.baseURL;
  const signupRes = await signAxios.post(SIGN_UP, { email, password }).catch(async (err) => {
    if (err.status === 409 && err.message.includes('is already registered')) {
      return await signAxios.post(SIGN_IN, {
        email,
        password,
      });
    }
    throw err;
  });

  const cookie = signupRes.headers['set-cookie'];

  const newUserAxios = createAxios();

  newUserAxios.interceptors.request.use((config) => {
    config.headers.Cookie = cookie;
    config.baseURL = signupRes.config.baseURL;
    return config;
  });

  const axiosResponse = await newUserAxios.get(USER_ME);
  console.log('new user signed session', JSON.stringify(axiosResponse.data, null, 2));

  return newUserAxios;
}
